// ===================== FIREBASE — CLOUD FIRESTORE =====================
// Estrategia anti-quota:
//   • 1 lectura al iniciar (getDoc) — NO listener permanente sobre toda la DB
//   • onSnapshot solo en doc 'db' — 1 documento = 1 lectura por cambio externo
//   • Flag _fbEscribiendo evita el loop escritura→listener→escritura
//   • Debounce 1200ms agrupa operaciones rápidas en UNA sola escritura
//   • Toda la DB en 1 documento Firestore → mínimo de operaciones posible

const APP_VERSION = '1.0.1';
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9pGcFJG1XNyVgcZNp2NKcxW0d1oat2qI",
  authDomain: "tienda-aleze.firebaseapp.com",
  projectId: "tienda-aleze",
  storageBucket: "tienda-aleze.firebasestorage.app",
  messagingSenderId: "231416120915",
  appId: "1:231416120915:web:749a1a6648d0006faf68a6"
};

let fbApp = null;
let fbFS = null;          // Firestore instance
let _fbEscribiendo = false; // Flag anti-loop: true mientras este dispositivo escribe
let _fbSaveTimer = null;
let _fbLastWriteTs = 0;     // timestamp del último fbGuardar() — protege ventana debounce
let _fbLastWriteProdTs = 0; // timestamp del último fbGuardarProductos()
let fbAuth = null; // Firebase Authentication
let fbFunctions = null; // Cloud Functions — pasarela de pago, dormida hasta activarse

// ── SDK modular — migración progresiva, paso 1 ──────────────────────────────
// Estas instancias apuntan a la MISMA app/proyecto que fbApp/fbFS de arriba (Compat) —
// no son una segunda conexión, es la misma, vista con la sintaxis nueva. Empiezan en null
// y se completan dentro de iniciarFirebase(), después de que Compat ya inicializó todo.
// Mientras ninguna función use dbModular/authModular/etc., el sistema entero sigue
// funcionando exactamente igual que antes — esto no reemplaza nada todavía, solo
// deja el camino tendido para migrar función por función.
let dbModular = null;
let authModular = null;
let storageModular = null;
let messagingModular = null;
// Alias cortos para las funciones modulares de Firestore — se asignan dentro de
// iniciarFirebase() una vez que window.__fbModular esta confirmado disponible. Evita repetir
// "window.__fbModular.firestore.X" en cada uno de los puntos de contacto que se van migrando.
let docM, setDocM, getDocM, getDocDelServidorM, getDocsM, deleteDocM, updateDocM, addDocM, collectionM,
    queryM, whereM, orderByM, limitM, writeBatchM, runTransactionM, incrementM,
    serverTimestampM, deleteFieldM, onSnapshotM;

// ══════════════════════════════════════════════════════════════════════════
// Visibilidad real de sincronización — camino completo, no un parche.
//
// El problema que resuelve: con persistencia offline activada, Firestore acepta
// cada escritura en una cola local y la reintenta solo cuando vuelve la señal —
// eso significa que, si NO hay conexión, la Promise de .set()/.update() queda
// simplemente PENDIENTE (ni resuelta ni rechazada), no falla. Por eso un
// .catch() nunca debería tratarse como "seguro, ya se resuelve solo" ni como
// "listo, ignoralo" — hay que distinguir 2 situaciones muy distintas:
//   1. Sigue pendiente (sin señal, o el servidor tarda) → normal, se resuelve
//      solo, no amerita interrumpir a nadie. Se refleja en un badge chico.
//   2. Falló de verdad (permisos, datos invalidos, cuota) → NUNCA se va a
//      resolver reintentando — el cajero tiene que enterarse ya, con una
//      alerta real, no una línea en la consola que nadie lee.
// ══════════════════════════════════════════════════════════════════════════
let _pendingSyncCount = 0;
let _pendingSyncDetalle = []; // [{tipo, id}] — para depuración si hace falta

const _ERRORES_PERMANENTES = new Set([
  'permission-denied', 'invalid-argument', 'not-found', 'resource-exhausted',
  'failed-precondition', 'out-of-range', 'unauthenticated', 'already-exists'
]);
function _esErrorPermanente(e) {
  return !!(e && _ERRORES_PERMANENTES.has(e.code));
}

// ── Diagnóstico real: cuenta cuántas veces se dispara cada tipo por ventana de 5s. Si algo
// se repite sospechosamente (>10 veces en 5s, mucho más que lo que una operación normal
// generaría), lo grita en consola con el tipo/id exactos — así la próxima vez que el punto
// parpadee, con la consola abierta (F12) se ve EXACTAMENTE qué lo está disparando, en vez
// de seguir adivinando desde el código estático.
let _sincDiagVentana = [];
function _sincDiagRegistrar(tipo, id) {
  const ahora = Date.now();
  _sincDiagVentana.push({ tipo, id, ts: ahora });
  _sincDiagVentana = _sincDiagVentana.filter(x => ahora - x.ts < 5000);
  const delMismoTipo = _sincDiagVentana.filter(x => x.tipo === tipo);
  if (delMismoTipo.length === 11) { // recien cruza el umbral, avisa una sola vez por racha
    console.warn(`⚠️ [Sync-Diag] "${tipo}" se disparó ${delMismoTipo.length} veces en 5 segundos — esto es sospechoso, no es una venta normal. IDs recientes:`, delMismoTipo.map(x => x.id));
  }
}

function _sincIniciar(tipo, id) {
  _sincDiagRegistrar(tipo, id);
  _pendingSyncCount++;
  _pendingSyncDetalle.push({ tipo, id, ts: Date.now() });
  _actualizarBadgeSync();
}
function _sincTerminar(tipo, id) {
  _pendingSyncCount = Math.max(0, _pendingSyncCount - 1);
  const idx = _pendingSyncDetalle.findIndex(x => x.tipo === tipo && x.id === id);
  if (idx >= 0) _pendingSyncDetalle.splice(idx, 1);
  _actualizarBadgeSync();
}
// descripcionUsuario: texto legible para el cajero ("la venta", "el fiado") — solo se usa
// si el error es permanente, para que la alerta diga qué NO se guardó, no un código técnico solo.
function _sincError(tipo, id, e, descripcionUsuario, contextoPublico) {
  _sincTerminar(tipo, id);
  console.warn(`[Sync] ${tipo}/${id}:`, e);
  if (_esErrorPermanente(e)) {
    const msg = contextoPublico
      ? `⚠️ No se pudo guardar ${descripcionUsuario || tipo}. Intenta de nuevo en unos minutos.`
      : `⚠️ No se pudo guardar ${descripcionUsuario || tipo}.

Este error no se resuelve solo reintentando — avisa al administrador.
Código: ${e.code || e.message || 'desconocido'}`;
    alert(msg);
  }
  // Si NO es permanente (típico: sin señal), Firestore ya lo tiene en su cola offline y lo
  // reintenta solo — el badge ya venía reflejando "pendiente" desde _sincIniciar, no hace
  // falta nada más acá.
}

let _syncBadgeHideTimer = null;
// Red de seguridad: con conexión activa, ningún pendiente debería tardar más de 15s en
// confirmarse o fallar. Si algo queda atascado ahí (mismo patrón que el bug de _fbEscribiendo
// que ya encontramos con las promociones), esto lo destraba solo y deja rastro en consola en
// vez de dejar el indicador prendido para siempre sin explicación.
setInterval(() => {
  if (!_pendingSyncDetalle.length) return;
  const ahora = Date.now();
  const atascados = _pendingSyncDetalle.filter(x => (ahora - x.ts) > 15000);
  if (atascados.length) {
    console.warn('[Sync] Pendientes atascados más de 15s, limpiando y dejando rastro:', atascados);
    atascados.forEach(x => {
      const idx = _pendingSyncDetalle.indexOf(x);
      if (idx >= 0) _pendingSyncDetalle.splice(idx, 1);
    });
    _pendingSyncCount = Math.max(0, _pendingSyncCount - atascados.length);
    _actualizarBadgeSync();
  }
}, 5000);

let _sincTraceUltimo = 0;
function _actualizarBadgeSync() {
  // Diagnostico definitivo: un rastro completo (que funcion llamo a que funcion) cada vez
  // que esto se dispara, pero como maximo cada 3 segundos para no saturar la consola.
  // Esto va a mostrar EXACTAMENTE quien esta disparando esto, sin necesidad de seguir
  // adivinando desde el codigo estatico.
  if (_pendingSyncCount > 0 && Date.now() - _sincTraceUltimo > 3000) {
    _sincTraceUltimo = Date.now();
    console.trace('🔍 [Sync-Trace] _actualizarBadgeSync disparado, pendientes:', _pendingSyncCount, _pendingSyncDetalle.map(x=>x.tipo+'/'+x.id));
  }
  // Con la causa real corregida (App Check/reCAPTCHA), esto ya no debería quedar trabado —
  // vuelve a mostrar el número, para que un vendedor entienda qué es de un vistazo.
  ['sync-badge', 'sync-badge-tienda'].forEach(elId => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (_pendingSyncCount > 0) {
      clearTimeout(_syncBadgeHideTimer);
      el.style.display = 'inline-flex';
      el.textContent = '↻ ' + _pendingSyncCount;
      el.title = _pendingSyncCount + ' cambio(s) guardados en este equipo, sincronizando con la nube...';
    } else {
      clearTimeout(_syncBadgeHideTimer);
      _syncBadgeHideTimer = setTimeout(() => {
        if (_pendingSyncCount <= 0) el.style.display = 'none';
      }, 700);
    }
  });
}
let fbStorage = null;     // Firebase Storage — imágenes de productos  
let _fbSnapshotUnsub = null; // Para desuscribirse si fuera necesario
let _pedidosOnlineUnsub = null; // Listener colección pedidos_online
let _fbCajaUnsub = null; // Listener dedicado a la colección caja — unica fuente de verdad
// ── Listeners operativos nuevos — 3 dependen de la sede activa (se reconectan al cambiar de
// sede), 5 son globales (no dependen de sede: stock trae ambas sedes en cada documento,
// clientes/promociones/canjes son compartidos, mermas es de bajo volumen). ──
let _fbStockUnsub = null;
let _fbVentasHoyUnsub = null;      // depende de sede
let _fbMovimientosHoyUnsub = null; // depende de sede
let _fbFiadosPendUnsub = null;     // depende de sede
let _fbClientesUnsub = null;
let _fbRecordatoriosUnsub = null;
let _fbPromocionesUnsub = null;
let _fbMermasMesUnsub = null;
let _fbGastosUnsub = null;
let _fbCapitalUnsub = null;
let _fbCanjesUnsub = null;

// ── Inicializar Firestore ──
// RECAPTCHA_SITE_KEY: reemplaza con tu clave de reCAPTCHA v3 desde Google reCAPTCHA Admin
// Si aún no tienes clave, usa 'debug' temporalmente solo en localhost
const RECAPTCHA_SITE_KEY = '6Le9bWMtAAAAAPWAyieo6txt9gh618Jk4FDp7OtF';

// VAPID_KEY: clave publica para notificaciones push (Firebase Console > Configuracion del
// proyecto > Cloud Messaging > Certificados push web > "Generar par de claves"). Es publica
// a proposito, va en el codigo igual que RECAPTCHA_SITE_KEY. Mientras diga 'PENDIENTE', las
// notificaciones push quedan dormidas — no rompe nada, solo no se activan hasta pegarla acá.
const VAPID_KEY = 'BBWLZJaIhkWmkeYT9B2GG9D0lK1uljNgCA7Jkelm8I06o6269EO-uywu-FoH4iicBksg5i1vSgeWhrL9l87bNng';

async function iniciarFirebase() {
  // DIAGNOSTICO TEMPORAL — cronometro real en cada etapa, para encontrar exactamente donde
  // se va el tiempo en las cargas lentas, en vez de seguir adivinando por orden de aparicion
  // en consola. Se puede quitar una vez encontrada la causa real de la demora intermitente.
  const _t0 = performance.now();
  const _tlog = (msg) => console.log(`⏱️ [T+${(performance.now()-_t0).toFixed(0)}ms] ${msg}`);
  _tlog('iniciarFirebase() arranca');
  try {
    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    _tlog('firebase.initializeApp() listo');

    // ── App Check (reCAPTCHA v3) — SDK Compat syntax ────────────────────────
    // firebase-app-check-compat.js expone firebase.appCheck() directamente
    // El provider se pasa como objeto {siteKey} — NO como clase constructora
    try {
     const appCheckInstance = firebase.appCheck(fbApp);
appCheckInstance.activate(RECAPTCHA_SITE_KEY, true);
      console.log('[AppCheck] activado correctamente');
      _tlog('[AppCheck] activate() retorno (no espera token, solo dispara)');
      // DIAGNOSTICO TEMPORAL — mide CUANTO TARDA REALMENTE generar el primer token de App
      // Check (reCAPTCHA v3), en paralelo, sin bloquear nada del flujo normal (no lleva
      // await).
      const _tAppCheckStart = performance.now();
      appCheckInstance.getToken().then(() => {
        console.log(`⏱️🔬 [DIAGNOSTICO] Token de App Check generado — tardo ${(performance.now()-_tAppCheckStart).toFixed(0)}ms`);
      }).catch(acTokenErr => {
        console.log(`⏱️🔬 [DIAGNOSTICO] Token de App Check FALLO tras ${(performance.now()-_tAppCheckStart).toFixed(0)}ms: ${acTokenErr.message}`);
      });
      // CRITICO: se eliminó la espera manual de "primer token antes de leer datos" que existía
      // acá. Firestore YA adjunta el token de App Check a cada pedido automáticamente, por su
      // cuenta, en cuanto activate() se llama — no hace falta pre-buscarlo a mano antes de
      // arrancar. Esa espera manual, en la práctica, agregaba varios segundos GARANTIZADOS a
      // cada login sin necesidad real, y coincidía con las fallas de reconciliación
      // reportadas ("no se pudo reconciliar caja/datos/gastos frescos") — pedir un token de
      // más, a mano, justo antes de la ráfaga real de lecturas, competía por el mismo recurso
      // en vez de ayudar. Si el primerísimo pedido sale sin token adjunto todavía, el manejo
      // ya construido (Promise.allSettled en el login) lo absorbe sin romper nada.
    } catch(acErr) {
      console.warn('[AppCheck] no activado — la app sigue funcionando:', acErr.message);
      _tlog('[AppCheck] fallo activate(): ' + acErr.message);
    }
    // ────────────────────────────────────────────────────────────────────────

   fbFS  = firebase.firestore();
      _tlog('firebase.firestore() (Compat) listo');
      // fbFS ya no hace ninguna operación real de Firestore — la migración completa al SDK
      // modular movió todo (las 157 referencias originales) a dbModular. Por eso ya no tiene
      // enablePersistence() acá — tenerlo generaba una segunda coordinación multi-pestaña vía
      // IndexedDB compitiendo con la de dbModular, causando permission-denied y demoras de
      // varios minutos (ya corregido, quitando esa llamada).
      fbAuth = firebase.auth();
      _tlog('firebase.auth() (Compat) listo');
      // CRITICO: sin esto, el SDK de Auth "adivina" el mejor metodo de persistencia segun el
      // navegador — en ciertos navegadores moviles con proteccion de privacidad fuerte, esa
      // auto-deteccion intenta requestStorageAccess() (pensado para contextos de iframe de
      // terceros, que esta app nunca es — corre standalone/PWA). Cuando el navegador la
      // rechaza ("Permission denied", visto en consola), el SDK puede quedar en un estado
      // roto que produce el TypeError no capturado que sigue justo despues en los logs.
      // Fijando el metodo explicito (localStorage simple, mismo origen, sin necesidad de
      // ningun permiso de terceros) se evita que el SDK intente esa deteccion en absoluto.
      try { fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch(persErr) { console.warn('[Auth] No se pudo fijar persistencia explicita (Compat):', persErr.message); }
      _tlog('setPersistence (Compat) listo');
      fbStorage = firebase.storage();
      _tlog('firebase.storage() (Compat) listo');
      // Pasarela de pago (dormida) — solo se usa si DB.config.pasarelaPago.activa es true
      // Y las Cloud Functions ya fueron desplegadas manualmente. Si no se desplegaron,
      // la llamada falla con un error claro (manejado en tndPagarEnLinea), no en silencio.
      try { fbFunctions = firebase.functions(); } catch(e) { fbFunctions = null; }

      // ── SDK modular — inicializar su PROPIA conexión al mismo proyecto ─────────
      // CORRECCION: getApp() fallaba con "No Firebase App '[DEFAULT]' has been created" —
      // Compat y el modulo ES son 2 paquetes cargados por separado desde el CDN (uno como
      // script clasico, otro como modulo), cada uno con su PROPIO registro interno de apps
      // en memoria — no comparten estado aunque sean la "misma version". La solucion real es
      // que el lado modular inicialice SU PROPIA conexion con el mismo FIREBASE_CONFIG —
      // apunta al mismo proyecto/base de datos real, son 2 conexiones tecnicas distintas a
      // la misma fuente de verdad, no 2 proyectos distintos. Si esto falla, el sistema entero
      // sigue funcionando igual por Compat — esto es un agregado, nunca un reemplazo.
      try {
        _tlog('a punto de chequear window.__fbModular');
        if (window.__fbModular) {
          _tlog('window.__fbModular SI esta disponible — arrancando rama modular');
          const appModular = window.__fbModular.initializeAppModular(FIREBASE_CONFIG);
          _tlog('initializeAppModular() listo');
          // CRITICO: persistentMultipleTabManager() (coordinación entre pestañas vía
          // IndexedDB) tiene problemas conocidos y documentados en navegadores móviles —
          // especialmente Safari iOS y los WebView de apps instaladas — donde la negociación
          // de "qué pestaña tiene el control" puede colgarse por minutos enteros, exactamente
          // el patrón reportado: escritorio rápido, móvil/PWA demorando mas de un minuto. En
          // un teléfono casi nunca hay 2 pestañas reales de la misma sesión compitiendo, así
          // que el beneficio es minimo comparado con el riesgo. Se usa persistencia de una
          // sola pestaña — sigue funcionando sin señal igual, solo que si alguien abre 2
          // pestañas del sistema a la vez en la misma compu, la segunda cae al respaldo sin
          // persistencia de mas abajo (no rompe nada, solo pierde cache offline en esa pestaña
          // extra puntual).
          // CRITICO: persistencia offline en disco DESACTIVADA por completo. Confirmado con
          // evidencia real y repetida (3 rondas de intentos de arreglo distintos, mismo
          // patron de fondo cada vez): onSnapshot() con persistencia activa SIEMPRE entrega
          // primero lo que tiene en cache local antes de sincronizar con el servidor — esto
          // es el diseño normal de Firestore, no un bug — pero sigue encontrando formas de
          // filtrarse en calculos criticos de stock (inventario mensual, entre otros),
          // causando corrupcion silenciosa de datos financieros reales que erosiona la
          // confianza del vendedor. Firestore sigue encolando escrituras en memoria mientras
          // la app este abierta AUNQUE no haya persistencia en disco — la app sigue pudiendo
          // vender durante un corte breve de red (el caso real y comun, ej. wifi que titila),
          // solo se pierde la proteccion contra el caso mucho mas raro de cerrar la app por
          // completo durante ese corte especifico. Ese costo raro es muchisimo menor que el
          // de la corrupcion silenciosa de stock que veniamos sufriendo repetidamente.
          dbModular = window.__fbModular.firestore.initializeFirestore(appModular, {
            // Redes moviles con proxy/firewall restrictivo a veces bloquean o retrasan
            // WebSockets — sin esto, Firestore espera un timeout completo antes de caer a
            // HTTP normal. Con esto, detecta el bloqueo de entrada y cambia de inmediato,
            // sin hacer esperar al usuario por ese timeout. Independiente de localCache —
            // se mantiene aunque la persistencia en disco este desactivada.
            experimentalAutoDetectLongPolling: true
          });
          _tlog('dbModular = getFirestore() SIN persistencia offline (desactivada a proposito)');
          authModular = window.__fbModular.auth.getAuth(appModular);
          _tlog('authModular = getAuth() listo');
          // CRITICO: encontrada la causa real de la demora intermitente de 20-30+ segundos,
          // confirmada con cronometros reales — setPersistence(authModular, ...) en el SDK
          // MODULAR podia colgarse mas de 30 SEGUNDOS en un intento y solo ~550ms en el
          // siguiente, misma linea exacta. browserLocalPersistence en el SDK modular usa
          // IndexedDB por dentro (a diferencia de la version Compat, que usa localStorage
          // simple y por eso siempre es instantanea) — el mismo tipo de bloqueo de
          // coordinacion entre pestañas/IndexedDB ya diagnosticado antes para Firestore
          // (persistentMultipleTabManager). El login real usa fbAuth (Compat,
          // signInWithEmailAndPassword en auth.js) — authModular no se usa para ningun login
          // real todavia, asi que fijarle persistencia no cumplia ningun proposito funcional,
          // solo el riesgo del cuelgue. Se elimina la llamada por completo — authModular
          // sigue disponible para cuando se migre el login real al SDK modular.
          storageModular = window.__fbModular.storage.getStorage(appModular);
          ({ doc: docM, setDoc: setDocM, getDoc: getDocM, getDocFromServer: getDocDelServidorM, getDocs: getDocsM, deleteDoc: deleteDocM,
             updateDoc: updateDocM, addDoc: addDocM, collection: collectionM, query: queryM,
             where: whereM, orderBy: orderByM, limit: limitM, writeBatch: writeBatchM,
             runTransaction: runTransactionM, increment: incrementM, serverTimestamp: serverTimestampM,
             deleteField: deleteFieldM, onSnapshot: onSnapshotM } = window.__fbModular.firestore);
          console.log('[SDK modular] Conexión propia inicializada con persistencia offline — listo para empezar a migrar funciones.');
          _tlog('[SDK modular] TODO listo — docM y el resto de funciones ya asignadas');
        } else {
          console.warn('[SDK modular] window.__fbModular no está disponible (¿el script type="module" no cargó?) — el sistema sigue funcionando por Compat sin problema.');
          _tlog('window.__fbModular NO disponible');
        }
      } catch(modErr) {
        console.warn('[SDK modular] No se pudo inicializar (el sistema sigue por Compat sin problema):', modErr.message);
        _tlog('rama modular completa fallo con excepcion: ' + modErr.message);
      }

      _tlog('iniciarFirebase() a punto de RETORNAR true');
      return true;
  } catch(e) {
    console.error('Firebase init error:', e);
    _tlog('iniciarFirebase() a punto de RETORNAR false — error: ' + e.message);
    return false;
  }
}

// ── Referencia al documento DB_EXT (sueldos, gastos, capital, niveles, etc.) ──
// CRITICO: mismo problema real ya encontrado y corregido en fbGuardarConfig() (ver esa
// funcion mas abajo) — sin esto, escribia el documento completo cada vez que CUALQUIER
// funcion llamaba fbGuardarExt(), aunque nada de lo que realmente vive aca (sueldos, capital,
// gastosRec) hubiera cambiado. Misma proteccion aplicada por consistencia.
let _ultimoExtGuardadoJSON = null;
function fbGuardarExt() {
  if (!dbModular) return; // [SDK modular]
  clearTimeout(window._fbExtTimer);
  window._fbExtTimer = setTimeout(() => {
    // 'gastos' se excluye — ya tiene su propia colección real como fuente de verdad
    // (gastos/{id}), escribirlo también acá sería una copia redundante que además arriesga
    // pisar, con un reemplazo completo del documento, un gasto recién creado desde otro
    // dispositivo. 'capital' se reduce a solo prestamo/cuota/meta — total/recuperado/
    // prestamoPagado son getters calculados desde DB.capitalMovimientos, no datos propios.
    const { gastos, ...extSinGastos } = DB_EXT;
    const payload = { ...extSinGastos, capital: { prestamo: DB_EXT.capital.prestamo, cuota: DB_EXT.capital.cuota, meta: DB_EXT.capital.meta } };
    const _extActualJSON = JSON.stringify(payload);
    if (_extActualJSON === _ultimoExtGuardadoJSON) return; // sin cambios reales, no escribir nada
    _fbEscribiendo = true;
    _sincIniciar('db_ext', 'db_ext');
    setDocM(docM(dbModular, 'aleze', 'db_ext'), JSON.parse(_extActualJSON))
      .then(() => { _ultimoExtGuardadoJSON = _extActualJSON; setTimeout(() => { _fbEscribiendo = false; }, 300); _sincTerminar('db_ext', 'db_ext'); })
      .catch(e => { _fbEscribiendo = false; _sincError('db_ext', 'db_ext', e, 'capital/configuración extendida'); });
  }, 1200);
}

// ── Configuración: documento propio, separado de aleze/db ──────────────────────────────────
// Antes vivía como un campo más dentro de aleze/db, guardado y cargado junto con
// ventas/clientes/etc — misma duplicidad que ya se corrigió para esos 6 campos. config es un
// objeto único (no una lista de registros), así que le alcanza con su propio documento, no
// necesita una colección con un documento por registro como ventas o clientes.
// CRITICO: sin esto, fbGuardarConfig() escribia el documento COMPLETO (sin merge) cada vez
// que se llamaba fbGuardar() desde CUALQUIER funcion — incluidas confirmarPagoFiado() y
// ejecutarPagoGlobal(), que nunca tocan config para nada. Confirmado con evidencia real de
// consola: un pago de fiado disparaba una escritura de "config/config" innecesaria, justo
// en el momento en que se reporto perdida de sincronizacion entre sesiones abiertas — 2
// sesiones escribiendo el mismo documento compartido sin necesidad real, compitiendo entre
// si por la ultima escritura, es exactamente el tipo de condicion de carrera que puede dejar
// una sesion con datos viejos. Ahora se compara contra el ultimo estado ya guardado antes de
// escribir — si config no cambio de verdad, no se dispara ninguna escritura.
let _ultimoConfigGuardadoJSON = null;
function fbGuardarConfig() {
  if (!dbModular) return; // [SDK modular]
  clearTimeout(window._fbConfigTimer);
  window._fbConfigTimer = setTimeout(() => {
    const _configActualJSON = JSON.stringify(DB.config || {});
    if (_configActualJSON === _ultimoConfigGuardadoJSON) return; // sin cambios reales, no escribir nada
    _sincIniciar('config', 'config');
    setDocM(docM(dbModular, 'aleze', 'config'), JSON.parse(_configActualJSON))
      .then(() => { _ultimoConfigGuardadoJSON = _configActualJSON; _sincTerminar('config', 'config'); })
      .catch(e => _sincError('config', 'config', e, 'la configuración del negocio'));
  }, 1200);
}

// ── Guardar operaciones (excluye productos y categorias) ──
// Debounce 1200ms — agrupa cambios rápidos en 1 sola escritura
let _fbSaveTimerProd = null;
let _fbWritingDB = false;   // Previene escrituras paralelas a aleze/db
let _fbWritingProd = false; // Previene escrituras paralelas a aleze/db_productos
// CRITICO: aleze/db quedo completamente vacio de contenido real — cada campo que tenia
// (ventas, clientes, fiados, mermas, movimientos, historialVentas, config, promociones,
// proveedores) ya fue migrado a su propia coleccion/documento, y lo unico que quedaba
// (payload.cajas) era un espejo que nadie leia desde que caja tiene su propio listener
// dedicado. Ya no hay ninguna razon para seguir escribiendo este documento — se elimina la
// escritura por completo. Esta funcion sigue existiendo (la llaman decenas de funciones en
// todo el archivo) para no tener que tocar cada una de ellas — ahora solo hace la poda de
// memoria local (que sigue siendo util, independiente de si se persiste o no) y dispara el
// guardado de configuración, que sí sigue siendo necesario.
function fbGuardar() {
  // Poda de memoria local — el historial completo de cada uno ya vive en su propia colección
  // (ventas/{id}, movimientos/{id}, fiados/{id}); esto solo evita que los arrays en memoria
  // crezcan sin límite durante una sesión larga, sin persistir el recorte en ningún lado.
  if (DB.historialVentas && DB.historialVentas.length) {
    const _limitePoda = new Date(); _limitePoda.setDate(_limitePoda.getDate() - 30);
    const _limitePodaStr = _limitePoda.toISOString().split('T')[0];
    DB.historialVentas = DB.historialVentas.filter(v => v.fecha >= _limitePodaStr);
  }
  if (DB.movimientos && DB.movimientos.length) {
    const _limitePodaMov = new Date(); _limitePodaMov.setDate(_limitePodaMov.getDate() - 30);
    const _limitePodaMovStr = _limitePodaMov.toISOString().split('T')[0];
    DB.movimientos = DB.movimientos.filter(m => m.fecha >= _limitePodaMovStr);
  }
  if (DB.fiados && DB.fiados.length) {
    const _limitePodaFiados = new Date(); _limitePodaFiados.setDate(_limitePodaFiados.getDate() - 90);
    const _limitePodaFiadosStr = _limitePodaFiados.toISOString().split('T')[0];
    DB.fiados = DB.fiados.filter(f => fiadoPendiente(f) || f.fecha >= _limitePodaFiadosStr);
  }
  fbGuardarConfig();
}

// ── Guardar solo productos y categorias en documento separado ──
// Se llama únicamente cuando el admin edita inventario/categorias
// ── NUEVO: escritura individual de productos (colección 'productos/{id}') ──
// CRITICO: fbGuardarProductos() de abajo reescribe el catalogo COMPLETO en un solo documento
// cada vez que se llama, para cualquier cambio por chico que sea — si 2 sesiones distintas
// escriben casi al mismo tiempo (ej. un cajero vendiendo mientras otro edita un producto), la
// que llega despues al servidor pisa por completo los cambios de la que llego primero, sin
// fusionar nada. Confirmado en la practica: un pack recien creado se perdio asi. Mismo
// principio ya aplicado a ventas/clientes/fiados/mermas/movimientos/promociones/proveedores
// — cada producto ahora se puede escribir solo, sin tocar el resto del catalogo. Migracion
// gradual: esta funcion nueva convive con fbGuardarProductos() (que se mantiene sin tocar)
// mientras cada llamador se pasa uno por uno a usar esta — stock se excluye a proposito, para
// no pisar una venta/ajuste concurrente que este tocando el stock al mismo tiempo desde otra
// sesion (stock es un campo plano simple, un solo numero — ya no hay mas de una sede).
let _fbProdSaveTimers = {}; // debounce por producto individual — {prodId: timerId}
function fbGuardarProducto(prodId) {
  if (!dbModular) return;
  if (!fbAuth || !fbAuth.currentUser) return;
  clearTimeout(_fbProdSaveTimers[prodId]);
  _fbProdSaveTimers[prodId] = setTimeout(() => {
    const prod = DB.productos.find(p => p.id === prodId);
    if (!prod) { // producto eliminado localmente — reflejar el borrado en la coleccion nueva tambien
      deleteDocM(docM(dbModular, 'productos', String(prodId))).catch(() => {});
      return;
    }
    const { stock, ...prodSinStock } = prod;
    _sincIniciar('productos', String(prodId));
    // CRITICO: merge:true es obligatorio aca. stock se excluye del payload a proposito (para
    // no pisar una venta/ajuste concurrente que este tocando el stock al mismo tiempo desde
    // otra sesion) — pero SIN merge, una escritura de Firestore reemplaza el documento ENTERO
    // con solo los campos del payload, borrando cualquier campo no incluido. Eso es lo que
    // estaba pasando antes: cada vez que se guardaba un producto (crear, editar cualquier
    // campo, o incluso el propio alta con "stock inicial"), el stock que ya se habia escrito
    // correctamente quedaba borrado 600ms despues por esta misma funcion. Con merge:true,
    // stock nunca se toca en absoluto — ni se borra ni se sobrescribe.
    setDocM(docM(dbModular, 'productos', String(prodId)), JSON.parse(JSON.stringify(prodSinStock)), { merge: true })
      .then(() => _sincTerminar('productos', String(prodId)))
      .catch(e => _sincError('productos', String(prodId), e, 'el producto ' + (prod.nombre || prodId)));
  }, 600);
}
// Version en lote — para cambios que tocan muchos productos a la vez (ej. importacion Excel,
// sincronizar mermas de inventario mensual). Un batch atomico por cada 200 productos (limite
// real de Firestore por batch), sin reescribir nada de los productos que NO estan en la lista.
async function fbGuardarProductosLote(prodIds) {
  if (!dbModular || !prodIds || !prodIds.length) return;
  const ids = [...new Set(prodIds)];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const trozo = ids.slice(i, i + CHUNK);
    const batch = writeBatchM(dbModular);
    trozo.forEach(id => {
      const prod = DB.productos.find(p => p.id === id);
      if (!prod) return;
      const { stock, ...prodSinStock } = prod;
      // CRITICO: merge:true obligatorio, mismo motivo que fbGuardarProducto() (ver arriba) —
      // sin esto, cada actualizacion masiva (Excel, precios por categoria, migracion de
      // imagenes) borraba el stock de TODOS los productos incluidos en el lote.
      batch.set(docM(dbModular, 'productos', String(id)), JSON.parse(JSON.stringify(prodSinStock)), { merge: true });
    });
    _sincIniciar('productos_lote', 'lote_' + i);
    try {
      await batch.commit();
      _sincTerminar('productos_lote', 'lote_' + i);
    } catch (e) {
      _sincError('productos_lote', 'lote_' + i, e, `la actualización de ${trozo.length} producto(s) — se aplicaron ${i} de ${ids.length} antes del error`);
      return;
    }
  }
}
// Listener de la coleccion nueva — mismo criterio ya usado para stock/ventas/clientes/etc,
// fusion incremental via docChanges() en vez de reemplazar el array entero. Convive en
// paralelo al listener viejo de db_productos mientras dura la migracion (ver mas abajo,
// fbEscuchar() sigue escuchando db_productos.categorias/config, ya no productos).
let _fbProductosColUnsub = null;
function fbEscucharProductosColeccion() {
  if (!dbModular) return;
  if (_fbProductosColUnsub) { _fbProductosColUnsub(); _fbProductosColUnsub = null; }
  _fbProductosColUnsub = onSnapshotM(collectionM(dbModular, 'productos'), snapshot => {
    let huboCambioReal = false;
    snapshot.docChanges().forEach(change => {
      if (change.doc.metadata.hasPendingWrites) return;
      const idx = DB.productos.findIndex(p => String(p.id) === change.doc.id);
      // CRITICO: un snapshot que viene de la cache local del dispositivo (no del servidor)
      // puede estar desactualizado. Si el producto ya existe en memoria (ya lo trajo la
      // reconciliacion de login, que lee directo del servidor via getDocs, no cache), un
      // cambio de cache se ignora — evita pisar datos reales con una version vieja cacheada.
      // Solo se aplica cache si el producto es nuevo para nosotros (algo es mejor que nada).
      if (snapshot.metadata.fromCache && idx !== -1) return;
      const data = change.doc.data();
      if (change.type === 'removed') {
        if (idx !== -1) { DB.productos.splice(idx, 1); huboCambioReal = true; }
      } else { // 'added' o 'modified' — data ya trae el stock unificado directo del
        // documento real, no hace falta preservar nada de la copia local vieja.
        if (idx !== -1) { DB.productos[idx] = data; } else { DB.productos.push(data); }
        huboCambioReal = true;
      }
    });
    if (!huboCambioReal) return;
    try { renderDashboard(); } catch(e){}
    try { updateAlertCount(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try {
      if (pageId === 'pos')        { renderPos(); if (typeof mobFilterPos === 'function') mobFilterPos(); else if (typeof renderMobPos === 'function') renderMobPos(); }
      if (pageId === 'inventario') { filterInventario(); }
      if (pageId === 'categorias') { renderCategorias(); }
    } catch(e){}
    // Tienda publica no usa el sistema de "page.active" (tiene su propio home/catalogo/
    // detalle via _tndVista) — sin esto, un visitante nunca veia productos/stock cambiar en
    // vivo, necesitaba salir por completo de la app y volver a entrar para verlo actualizado.
    try {
      if (typeof _tndVista !== 'undefined') {
        if (_tndVista === 'home') { if (typeof _tndRenderHome === 'function') _tndRenderHome(); }
        else if (typeof tndFiltrar === 'function') tndFiltrar();
      }
    } catch(e){}
  }, err => { console.warn('Firestore listener error (productos):', err.code); });
}

function fbGuardarProductos() {
  if (!dbModular) return; // [SDK modular]
  if (!fbAuth || !fbAuth.currentUser) return;
  _fbLastWriteProdTs = Date.now();
  clearTimeout(_fbSaveTimerProd);
 _fbSaveTimerProd = setTimeout(function _tryGuardarProd() {
    if (_fbWritingProd) { _fbSaveTimerProd = setTimeout(_tryGuardarProd, 500); return; }
    _fbEscribiendo = true;
    _fbWritingProd = true;
    // CRITICO: usuariosStaff SI tiene que estar acá, con email incluido — el propio proceso
    // de login lo necesita ANTES de autenticar (el selector de usuario se llena desde acá, y
    // doLogin() usa el email para el signInWithEmailAndPassword real). Una ronda anterior lo
    // sacó pensando que era un dato sensible innecesario en un documento público, sin darse
    // cuenta de que el login entero depende de que esté ahí — eso dejó el selector vacío y el
    // login roto por completo. El email de un cajero, solo, no es una credencial (todavía
    // hace falta la contraseña real, que nunca vive en Firestore) — es el mismo nivel de
    // exposición que cualquier login por correo público en cualquier sistema.
    const _configPublico = {
  nombre: DB.config?.nombre, direccion: DB.config?.direccion, ruc: DB.config?.ruc,
  whatsappTienda: DB.config?.whatsappTienda, ticketMsg: DB.config?.ticketMsg,
  requiereVerificacionSMS: DB.config?.requiereVerificacionSMS,
  pasarelaPago: DB.config?.pasarelaPago,
  usuariosStaff: DB.config?.usuariosStaff || [],
  // CRITICO: faltaban acá — sin esto, cada fbGuardarProductos() (que corre en cualquier
  // edición de producto/categoría, no solo al guardar Configuración) borraba en silencio
  // estos campos del documento remoto, aunque siguieran viéndose bien en memoria local del
  // admin. Un visitante nuevo, leyendo el documento remoto fresco, nunca los recibía.
 eslogan: DB.config?.eslogan, bannerVisible: DB.config?.bannerVisible,
  banners: DB.config?.banners || [], serviciosBannerUrl: DB.config?.serviciosBannerUrl,
  serviciosBanners: DB.config?.serviciosBanners || [],
  tiendasTexto: DB.config?.tiendasTexto, tiendasExternas: DB.config?.tiendasExternas || [],
  serviciosWa: DB.config?.serviciosWa || [],
  // CRITICO: faltaba este campo — tienda publica lee su configuracion especificamente de
  // este documento (aleze/db_productos), nunca de aleze/db. Sin deliveryMinimo aca, el valor
  // configurado en Configuracion nunca llegaba a tienda publica, sin importar que boton se
  // tocara para guardar — siempre caia al fallback de 20 en tienda-publica.js.
  deliveryMinimo: DB.config?.deliveryMinimo
};
    // FASE 4/4 migracion de productos: 'productos' ya NO se escribe aca — cada producto vive
    // en su propia coleccion (ver fbGuardarProducto/fbGuardarProductosLote mas arriba), la
    // misma razon por la que ventas/clientes/fiados/stock ya no viven en un documento unico.
    // setDocM (sin merge) limpia el campo 'productos' viejo del documento apenas esto corra
    // una vez, sin necesitar un script de limpieza aparte.
    const payload = {
      categorias: JSON.parse(JSON.stringify(DB.categorias)),
      config:     JSON.parse(JSON.stringify(_configPublico))
    };
    _sincIniciar('db_productos', 'db_productos');
    setDocM(docM(dbModular, 'aleze', 'db_productos'), payload) // [SDK modular]
      .then(() => {
        _fbProdCacheTs = Date.now(); // actualizar timestamp caché
        _fbWritingProd = false;
        setTimeout(() => { _fbEscribiendo = false; }, 300);
        _sincTerminar('db_productos', 'db_productos');
      })
      .catch(e => { _fbWritingProd = false; _fbEscribiendo = false; _sincError('db_productos', 'db_productos', e, 'el catálogo de productos y el stock'); });
  }, 1200);
}


// ── Escuchar cambios de OTROS dispositivos ──
// doc 'db' → operaciones  |  doc 'db_productos' → catálogo
let _fbProdCacheTs = 0; // timestamp última carga de db_productos
function fbEscuchar() {
  if (!fbFS) return;
  // CRITICO: el listener de aleze/db se eliminó por completo — desde que fbGuardar() ya no
  // escribe nada ahí (todo migrado a sus propias colecciones/documentos), nada en operación
  // normal vuelve a tocar ese documento, así que este listener nunca se disparaba de verdad.
  // El listener de db_productos (catálogo) sigue siendo necesario y activo, abajo.

  // Listener db_productos (categorías/config — solo si otro dispositivo admin cambia algo.
  // CRITICO FASE 4/4 migracion de productos: productos ya NO se lee de aca — este documento
  // guarda una copia vieja congelada de antes de la migracion (fbGuardarProductos() ya no la
  // actualiza), sobrescribir DB.productos con eso borraria cualquier cambio real hecho
  // despues via la coleccion propia. Ver fbEscucharProductosColeccion() mas abajo, que es la
  // que ahora mantiene DB.productos al dia en tiempo real.)
  onSnapshotM(docM(dbModular, 'aleze', 'db_productos'), snapshot => { // [SDK modular]
    if (_fbEscribiendo) return;
    if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
    if (Date.now() - _fbLastWriteProdTs < 2000) return;
    if (!snapshot.exists()) return; // en modular, exists es un METODO, no una propiedad
    const data = snapshot.data();
    if (!data) return;
    if (data.categorias) DB.categorias = data.categorias;
    if (data.config)     DB.config     = { ...DB.config, ...data.config };
    _fbProdCacheTs = Date.now();
    try { renderDashboard(); } catch(e){}
    try { updateAlertCount(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try {
      if (pageId === 'categorias') { renderCategorias(); }
    } catch(e){}
  }, err => { console.warn('Firestore db_productos listener error:', err.code); });

  // Migra el historial viejo de capital (antes vivia como capital.hist dentro de db_ext) a
  // su propia colección real, una entrada por documento. ID determinístico (no getId()) a
  // propósito: si 2 dispositivos ven el mismo db_ext viejo y migran "al mismo tiempo", generan
  // el mismo ID para la misma entrada — la segunda escritura sobrescribe la primera con el
  // mismo valor, en vez de crear un duplicado. Nunca se pierde ni se repite una entrada.
  function _migrarCapitalHistSiHaceFalta(histViejo) {
    if (!dbModular) return;
    const batch = writeBatchM(dbModular);
    const nuevos = [];
    histViejo.forEach((h, idx) => {
      const idDeterministico = 'migrado_' + idx + '_' + (h.fecha||'').replace(/\D/g,'');
      const data = { id: idDeterministico, tipo: h.tipo, fecha: h.fecha, desc: h.desc, monto: Math.abs(h.monto||0), usuario: 'Migración automática', sedeId: 'principal' };
      batch.set(docM(dbModular, 'capital_movimientos', idDeterministico), data);
      nuevos.push(data);
    });
    batch.commit()
      .then(() => { nuevos.forEach(n => { if (!DB.capitalMovimientos.find(m=>m.id===n.id)) DB.capitalMovimientos.push(n); }); try { renderCapital(); } catch(e){} })
      .catch(e => console.warn('No se pudo migrar el historial viejo de capital', e));
  }

  // Listener para DB_EXT (sueldos, capital, config extendida)
  onSnapshotM(docM(dbModular, 'aleze', 'db_ext'), snapshot => { // [SDK modular]
    if (_fbEscribiendo) return;
    if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
    if (Date.now() - _fbLastWriteTs < 2000) return;
    if (!snapshot.exists()) return; // en modular, exists es un METODO, no una propiedad
    const ext = snapshot.data();
    if (!ext) return;
    // 'gastos' se excluye a propósito — tiene su propio listener dedicado sobre su colección
    // real (fbEscucharGastos), que fusiona cambios en vez de reemplazar todo el documento. Si
    // este listener también lo tocara, un reemplazo completo de db_ext entre 2 dispositivos
    // podría pisar un gasto recién creado en el otro, incluso con el listener dedicado activo.
    // 'capital' TAMBIÉN se excluye del reemplazo — total/recuperado/prestamoPagado ahora son
    // getters calculados desde DB.capitalMovimientos (ver core.js), no valores planos.
    // Reemplazar el objeto entero borraría esos getters. Solo se fusionan los 3 campos de
    // configuración reales (prestamo/cuota/meta), que sí siguen viviendo acá.
    Object.keys(ext).forEach(k => {
      if (k === 'gastos') return;
      if (k === 'capital') {
        if (ext.capital) ['prestamo','cuota','meta'].forEach(campo => {
          if (ext.capital[campo] != null) DB_EXT.capital[campo] = ext.capital[campo];
        });
        return;
      }
      if (k in DB_EXT) DB_EXT[k] = ext[k];
    });
    // Migración defensiva, una sola vez: si el documento viejo todavía trae un historial de
    // capital (capital.hist, de antes de esta separación) y la colección nueva sigue vacía,
    // se migra automático — sin esto, el historial completo de aportes/pagos/ganancias
    // quedaría invisible para siempre, aunque el numero seguia estando ahi.
    if (ext.capital && Array.isArray(ext.capital.hist) && ext.capital.hist.length && !DB.capitalMovimientos.length) {
      _migrarCapitalHistSiHaceFalta(ext.capital.hist);
    }
    try { renderDashboard(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try {
      if (pageId === 'gastos')        { renderGastos(); }
      if (pageId === 'capital')       { renderCapital(); }
      if (pageId === 'frecuentes')    { renderFrecuentes(); }
      if (pageId === 'configuracion') { renderConfiguracion(); }
      if (pageId === 'reportes')      { generarReporte(); }
    } catch(e){}
  }, err => { console.warn('Firestore db_ext listener error:', err.code); });
}

// ── Listener dedicado a la colección caja — única fuente de verdad para DB._cajas ──────────
// Escucha las 2 sedes a la vez. Cualquier cambio en cualquier dispositivo (o el propio,
// una vez confirmado por el servidor) se refleja acá, en tiempo real, en cualquier otro
// dispositivo con la app abierta — sin necesitar recargar ni navegar. Reemplaza por completo
// la dependencia que antes existía en el documento combinado aleze/db.
function fbEscucharCaja() {
  if (!dbModular) return; // [SDK modular]
  if (_fbCajaUnsub) { _fbCajaUnsub(); _fbCajaUnsub = null; }
  _fbCajaUnsub = onSnapshotM(collectionM(dbModular, 'caja'), snapshot => {
    let huboCambioReal = false;
    snapshot.forEach(doc => {
      // Ignorar el eco optimista local (todavía no confirmado por el servidor) — esperar
      // la confirmación real evita parpadeos y evita reaccionar dos veces al mismo cambio.
      if (doc.metadata.hasPendingWrites) return;
      DB._cajas[doc.id] = doc.data();
      huboCambioReal = true;
    });
    if (!huboCambioReal) return;
    try { renderDashboard(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    if (pageId === 'caja') { try { renderCaja(); } catch(e){} }
  }, err => { console.warn('Firestore listener error (caja):', err.code); });
}

// ── Helper generico: aplica los cambios de un snapshot (docChanges) sobre un array local en
// memoria, SIN reemplazarlo entero — solo agrega/actualiza/quita lo que realmente cambio. Esto
// es CRITICO para listeners filtrados (hoy, pendientes, mes actual): el array local tiene datos
// FUERA del alcance del filtro (ventas de ayer, fiados ya pagados, mermas del mes pasado) que
// vinieron de la reconciliacion de login — un reemplazo completo del array los borraria de
// memoria por error, aunque sigan existiendo en Firestore.
function _aplicarCambiosSnapshot(snapshot, arr, idKey = 'id') {
  let huboCambio = false;
  snapshot.docChanges().forEach(change => {
    if (change.doc.metadata.hasPendingWrites) return; // eco optimista local — esperar confirmacion real del servidor
    const data = change.doc.data();
    const idx = arr.findIndex(x => String(x[idKey]) === change.doc.id);
    if (change.type === 'removed') {
      // El documento dejo de cumplir el filtro (ej. un fiado que se pago, saliendo de
      // "pendiente") — no significa que se borro de Firestore, solo que ya no aplica acá.
      if (idx !== -1) { arr.splice(idx, 1); huboCambio = true; }
    } else { // 'added' o 'modified'
      if (idx !== -1) { arr[idx] = data; } else { arr.push(data); }
      huboCambio = true;
    }
  });
  return huboCambio;
}

// ── Ventas y movimientos de HOY. Se acotan a hoy a proposito: es lo que
// resuelve "verlo mientras pasa" sin pagar por escuchar años de historial que ya nadie
// necesita ver en vivo — el historial viejo lo sigue trayendo la reconciliacion de login.
function fbEscucharVentasHoy() {
  if (!dbModular) return;
  if (_fbVentasHoyUnsub) { _fbVentasHoyUnsub(); _fbVentasHoyUnsub = null; }
  const sede = sedeAdminEfectiva();
  if (!DB.historialVentas) DB.historialVentas = [];
  _fbVentasHoyUnsub = onSnapshotM(
    queryM(collectionM(dbModular, 'ventas'), whereM('fecha', '==', today()), whereM('sedeId', '==', sede)),
    snapshot => {
      if (!_aplicarCambiosSnapshot(snapshot, DB.historialVentas)) return;
      try { renderDashboard(); } catch(e){}
      const activePage = document.querySelector('.page.active');
      const pageId = activePage ? activePage.id.replace('page-','') : '';
      try {
        if (pageId === 'historial-ventas') renderHistorialVentas();
        if (pageId === 'caja') renderCaja();
      } catch(e){}
    }, err => { console.warn('Firestore listener error (ventas hoy):', err.code); });
}

function fbEscucharMovimientosHoy() {
  if (!dbModular) return;
  if (_fbMovimientosHoyUnsub) { _fbMovimientosHoyUnsub(); _fbMovimientosHoyUnsub = null; }
  const sede = sedeAdminEfectiva();
  if (!DB.movimientos) DB.movimientos = [];
  _fbMovimientosHoyUnsub = onSnapshotM(
    queryM(collectionM(dbModular, 'movimientos'), whereM('fecha', '==', today()), whereM('sedeId', '==', sede)),
    snapshot => {
      if (!_aplicarCambiosSnapshot(snapshot, DB.movimientos)) return;
      const activePage = document.querySelector('.page.active');
      const pageId = activePage ? activePage.id.replace('page-','') : '';
      try { if (pageId === 'caja') renderCaja(); } catch(e){}
    }, err => { console.warn('Firestore listener error (movimientos hoy):', err.code); });
}

// ── Fiados pendientes de la sede activa — filtrado por estado, no por fecha (un fiado puede
// llevar meses sin pagarse y sigue siendo relevante verlo). Cuando un fiado se paga y deja de
// cumplir "pendiente", el propio listener lo saca de la vista en todos los dispositivos, en
// vivo, cerrando el riesgo real de doble cobro entre 2 personas que no se ven entre sedes.
function fbEscucharFiadosPendientes() {
  if (!dbModular) return;
  if (_fbFiadosPendUnsub) { _fbFiadosPendUnsub(); _fbFiadosPendUnsub = null; }
  const sede = sedeAdminEfectiva();
  if (!DB.fiados) DB.fiados = [];
  _fbFiadosPendUnsub = onSnapshotM(
    queryM(collectionM(dbModular, 'fiados'), whereM('estado', '==', 'pendiente'), whereM('sedeId', '==', sede)),
    snapshot => {
      if (!_aplicarCambiosSnapshot(snapshot, DB.fiados)) return;
      // CRITICO: causa real de la perdida de sincronizacion del dashboard reportada y
      // confirmada por el usuario (con evidencia de consola + comparacion visual entre 2
      // sesiones abiertas). Los datos siempre llegaban bien a DB.fiados — el problema era que
      // este listener nunca volvia a dibujar el dashboard, a diferencia de fbEscucharVentasHoy
      // (que si lo hace siempre). Por eso "Ventas Hoy" se actualizaba solo y "Deuda en fiados"
      // se quedaba vieja hasta navegar a otra pantalla y volver — no era un problema de datos,
      // era que nada disparaba el repintado mientras se estaba mirando el dashboard.
      try { renderDashboard(); } catch(e){}
      const activePage = document.querySelector('.page.active');
      const pageId = activePage ? activePage.id.replace('page-','') : '';
      try { if (pageId === 'fiados') renderFiados(); } catch(e){}
    }, err => { console.warn('Firestore listener error (fiados pendientes):', err.code); });
}

// ── Recordatorios: sin filtro — modulo de proposito general (envases, herramientas, o
// cualquier otra cosa pendiente con un cliente), se necesita ver tanto pendientes como ya
// devueltos para el historial completo. Sin filtro de sede, mismo criterio que clientes.
function fbEscucharRecordatorios() {
  if (!dbModular) return;
  if (_fbRecordatoriosUnsub) { _fbRecordatoriosUnsub(); _fbRecordatoriosUnsub = null; }
  if (!DB.recordatorios) DB.recordatorios = [];
  _fbRecordatoriosUnsub = onSnapshotM(
    collectionM(dbModular, 'recordatorios'),
    snapshot => {
      if (!_aplicarCambiosSnapshot(snapshot, DB.recordatorios)) return;
      const activePage = document.querySelector('.page.active');
      const pageId = activePage ? activePage.id.replace('page-','') : '';
      try { if (pageId === 'recordatorios') renderRecordatorios(); } catch(e){}
    }, err => { console.warn('Firestore listener error (recordatorios):', err.code); });
}

// ── Clientes: sin filtro — compartidos entre sedes a proposito (puntos/compras/total son del
// negocio completo). Resuelve el riesgo real de que 2 cajeros, en sedes distintas o la misma,
// creen el mismo cliente sin saberlo.
function fbEscucharClientes() {
  if (!dbModular) return;
  if (_fbClientesUnsub) { _fbClientesUnsub(); _fbClientesUnsub = null; }
  if (!DB.clientes) DB.clientes = [];
  _fbClientesUnsub = onSnapshotM(collectionM(dbModular, 'clientes'), snapshot => {
    let huboCambio = false;
    snapshot.docChanges().forEach(change => {
      if (change.doc.metadata.hasPendingWrites) return;
      const data = change.doc.data();
      const idx = DB.clientes.findIndex(x => String(x.id) === change.doc.id);
      if (change.type === 'removed') {
        if (idx !== -1) { DB.clientes.splice(idx, 1); huboCambio = true; }
      } else if (idx !== -1) {
        // Actualizar en el lugar, preservando el Proxy ya envuelto — reemplazar el objeto
        // entero perderia el wrapper y dejaria de sincronizar ediciones futuras desde acá.
        // _clienteProxySkipSync evita que Object.assign, al escribir sobre el Proxy, dispare
        // una escritura de vuelta a Firestore — este cambio YA vino de Firestore, reenviarlo
        // seria una escritura redundante (y, peor, competiria con el propio origen del cambio).
        _clienteProxySkipSync = true;
        try { Object.assign(DB.clientes[idx], data); }
        finally { _clienteProxySkipSync = false; }
        huboCambio = true;
      } else {
        _migrarDeudaClienteSiHaceFalta(data);
        DB.clientes.push(_envolverCliente(data));
        huboCambio = true;
      }
    });
    if (!huboCambio) return;
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try {
      if (pageId === 'clientes') renderClientes();
      if (pageId === 'pos')      updatePosClientes();
    } catch(e){}
  }, err => { console.warn('Firestore listener error (clientes):', err.code); });
}

// ── Promociones: sin filtro — pocas activas a la vez, y ya se habia pedido explicitamente
// que la sincronizacion de productos y promociones fuera inmediata.
function fbEscucharPromociones() {
  if (!dbModular) return;
  if (_fbPromocionesUnsub) { _fbPromocionesUnsub(); _fbPromocionesUnsub = null; }
  if (!DB.promociones) DB.promociones = [];
  _fbPromocionesUnsub = onSnapshotM(collectionM(dbModular, 'promociones'), snapshot => {
    if (!_aplicarCambiosSnapshot(snapshot, DB.promociones)) return;
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try { if (pageId === 'promociones') renderPromociones(); } catch(e){}
  }, err => { console.warn('Firestore listener error (promociones):', err.code); });
}

// ── Mermas del MES ACTUAL — no depende de sede (mermas se ven en conjunto), filtrado por mes
// calendario porque un mes ya cerrado ya se cuadro, no hace falta seguir pagando por verlo en
// vivo. La reconciliacion de login sigue trayendo TODAS, sin limite — este listener es solo
// para lo que todavia esta "abierto" del mes en curso.
function fbEscucharMermasMes() {
  if (!dbModular) return;
  if (_fbMermasMesUnsub) { _fbMermasMesUnsub(); _fbMermasMesUnsub = null; }
  if (!DB.mermas) DB.mermas = [];
  const _inicioMes = today().slice(0, 7) + '-01'; // YYYY-MM-01
  _fbMermasMesUnsub = onSnapshotM(
    queryM(collectionM(dbModular, 'mermas'), whereM('fecha', '>=', _inicioMes)),
    snapshot => {
      if (!_aplicarCambiosSnapshot(snapshot, DB.mermas)) return;
      try { renderDashboard(); } catch(e){}
      const activePage = document.querySelector('.page.active');
      const pageId = activePage ? activePage.id.replace('page-','') : '';
      try { if (pageId === 'mermas') renderMermas(); } catch(e){}
    }, err => { console.warn('Firestore listener error (mermas mes):', err.code); });
}

// ── Canjes: sin filtro — cierra el riesgo real de doble canje del mismo premio por 2
// dispositivos que no se veian entre si, mismo motivo que fiados pendientes.
function fbEscucharCanjes() {
  if (!dbModular) return;
  if (_fbCanjesUnsub) { _fbCanjesUnsub(); _fbCanjesUnsub = null; }
  if (!DB.canjes) DB.canjes = [];
  _fbCanjesUnsub = onSnapshotM(collectionM(dbModular, 'canjes'), snapshot => {
    if (!_aplicarCambiosSnapshot(snapshot, DB.canjes)) return;
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try { if (pageId === 'frecuentes') renderFrecuentes(); } catch(e){}
  }, err => { console.warn('Firestore listener error (canjes):', err.code); });
}

// ── Gastos: colección propia dedicada (gastos/{id}), sin filtro — bajo volumen, mismo
// criterio que clientes/promociones/mermas. CRITICO: antes, la única vía de sincronización de
// gastos era el documento compartido db_ext (ver listener de db_ext más abajo, que YA NO
// toca 'gastos' a propósito) — un reemplazo completo de ese documento entre 2 dispositivos
// podía pisar un gasto recién creado en el otro. Cada gasto individual ya vivía seguro en su
// propia colección desde antes — solo faltaba que algo lo escuchara en vivo desde ahí.
function fbEscucharGastos() {
  if (!dbModular) return;
  if (_fbGastosUnsub) { _fbGastosUnsub(); _fbGastosUnsub = null; }
  if (!DB_EXT.gastos) DB_EXT.gastos = [];
  _fbGastosUnsub = onSnapshotM(collectionM(dbModular, 'gastos'), snapshot => {
    if (!_aplicarCambiosSnapshot(snapshot, DB_EXT.gastos)) return;
    try { renderDashboard(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try {
      if (pageId === 'gastos') renderGastos();
      if (pageId === 'capital') renderCapital();
      if (pageId === 'reportes') generarReporte();
    } catch(e){}
  }, err => { console.warn('Firestore listener error (gastos):', err.code); });
}

// ── Capital: colección propia dedicada (capital_movimientos/{id}), sin filtro — bajo
// volumen (aportes/pagos de préstamo/cierres de mes no son frecuentes). CRITICO: antes, la
// única vía era el documento compartido db_ext, sin ninguna colección propia de respaldo —
// a diferencia de gastos, un reemplazo completo de db_ext podía perder un aporte de capital
// para siempre, sin forma de recuperarlo. Ahora cada movimiento vive seguro, atómico, en su
// propio documento.
function fbEscucharCapitalMovimientos() {
  if (!dbModular) return;
  if (_fbCapitalUnsub) { _fbCapitalUnsub(); _fbCapitalUnsub = null; }
  if (!DB.capitalMovimientos) DB.capitalMovimientos = [];
  _fbCapitalUnsub = onSnapshotM(collectionM(dbModular, 'capital_movimientos'), snapshot => {
    if (!_aplicarCambiosSnapshot(snapshot, DB.capitalMovimientos)) return;
    try { renderDashboard(); } catch(e){}
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    try { if (pageId === 'capital') renderCapital(); } catch(e){}
  }, err => { console.warn('Firestore listener error (capital_movimientos):', err.code); });
}

// ── Arranca los 10 listeners operativos de una — se llama una vez en el login (PASO 6, junto
// a los que ya existian) y de vuelta cada vez que el admin cambia de sede activa (los 3 que
// dependen de sede se reconectan solos, los otros 7 no necesitan tocarse de nuevo).
// CRITICO: los 10 listeners de acá arrancaban todos de golpe, en el mismo instante — un
// patron conocido que dispara BloomFilterError en cascada en el SDK de Firestore (el cache
// local offline necesita re-sincronizar con el servidor, y con muchos listeners abriendose a
// la vez, varios lo disparan al mismo tiempo). Coincide con la demora real reportada (varios
// segundos, peor en redes moviles). Escalonarlos con un pequeño delay entre cada uno le da
// respiro al motor de sincronizacion — no elimina el problema de raiz (es un comportamiento
// del SDK, no algo que se controle desde acá), pero reduce cuantos listeners lo disparan
// exactamente al mismo tiempo.
function _iniciarListenersOperativos() {
  fbEscucharClientes();
  setTimeout(() => { fbEscucharVentasHoy(); fbEscucharMovimientosHoy(); fbEscucharProductosColeccion(); }, 120);
  setTimeout(() => { fbEscucharFiadosPendientes(); fbEscucharPromociones(); }, 240);
  setTimeout(() => { fbEscucharMermasMes(); fbEscucharCanjes(); fbEscucharRecordatorios(); }, 360);
  setTimeout(() => { fbEscucharGastos(); fbEscucharCapitalMovimientos(); }, 480);
}

// ── Patch DB: interceptar asignaciones de array para auto-guardar ──
// Solo las colecciones que el usuario modifica activamente
// Columnas que van al doc 'db' (operaciones)
// caja NO va aquí — tiene su propio getter/setter por sede, definido junto a la declaración de DB.
// CRITICO: ventas/clientes/fiados/mermas/movimientos/promociones YA NO necesitan este
// interceptor — tienen su propia coleccion con escritura explicita en cada funcion, no
// dependen de que una reasignacion de array dispare fbGuardar() por su cuenta. Solo queda
// proveedores, todavia sin migrar. inventariosMensuales era un campo muerto (la data real
// siempre vivio en DB_EXT.inventariosMensuales, con su propio documento) — eliminado.
const _fbPatchColsOp   = ['proveedores'];
// Columnas que van al doc 'db_productos' (catálogo)
const _fbPatchColsProd = ['productos','categorias'];

function fbPatchDB() {
  // Ensure new fields exist for users upgrading from older versions
  if (!DB.config) DB.config = {};
  if (DB.config.montoAperturaAuto === undefined) DB.config.montoAperturaAuto = 0;
  // Migración/respaldo: de FIREBASE_USERS (fijo en código) a DB.config.usuariosStaff (editable
  // desde Configuración) — se dispara tambien si el array llega vacio desde el servidor por
  // cualquier motivo, no solo la primera vez, asi el login nunca queda sin nadie para elegir.
  if (!DB.config.usuariosStaff || DB.config.usuariosStaff.length === 0) {
    const _rolesLegado = { 'Aleze': 'admin', 'Aleze I': 'cajero', 'Aleze II': 'cajero' };
    DB.config.usuariosStaff = Object.keys(FIREBASE_USERS).map(nombre => ({
      nombre, email: FIREBASE_USERS[nombre], rol: _rolesLegado[nombre] || 'cajero', sedeId: 'principal'
    }));
  } else {
    // CRITICO: migracion real de los NOMBRES YA GUARDADOS en Firestore — el respaldo de arriba
    // (FIREBASE_USERS) ya tiene los nombres enmascarados nuevos, pero eso NO cambia lo que ya
    // esta persistido en la coleccion real. Si el dato real trae el nombre viejo (email
    // conocido, nombre distinto al esperado), se corrige acá Y se guarda de vuelta — sin esto,
    // cada vez que la lectura real tenia exito (a diferencia de cuando fallaba y caia al
    // respaldo) el selector mostraba el nombre real viejo en vez del enmascarado, exactamente
    // la inconsistencia reportada.
    const _nombreNuevoPorEmail = {};
    Object.keys(FIREBASE_USERS).forEach(nombreNuevo => { _nombreNuevoPorEmail[FIREBASE_USERS[nombreNuevo]] = nombreNuevo; });
    let _huboMigracion = false;
    DB.config.usuariosStaff.forEach(u => {
      const nombreNuevo = _nombreNuevoPorEmail[u.email];
      if (nombreNuevo && u.nombre !== nombreNuevo) {
        u.nombre = nombreNuevo;
        _huboMigracion = true;
      }
    });
    // Elimina activamente cualquier registro de "Aleze III"/Betty que ya estuviera guardado en
    // Firestore desde antes — el negocio pasa a operar con una sola sede, esa cuenta no existe
    // más. Sin esto, ya no se vuelve a crear, pero la que ya estaba guardada seguiria ahi.
    const _cantAntesLimpieza = DB.config.usuariosStaff.length;
    DB.config.usuariosStaff = DB.config.usuariosStaff.filter(u => u.nombre !== 'Aleze III' && u.email !== 'sccp.jlezama@gmail.com');
    if (DB.config.usuariosStaff.length !== _cantAntesLimpieza) _huboMigracion = true;
    if (_huboMigracion) {
      console.warn('[Migración] usuariosStaff actualizado (nombres/eliminación de sede 2) — guardando de vuelta.');
      try { fbGuardarConfig(); } catch(e) {}
      try { fbGuardarProductos(); } catch(e) {}
    }
  }
  // CRITICO: causa raiz real del "saldo heredado S/0.00" persistente incluso con lectura
  // garantizada por transaccion — esta linea, sin proteccion, escribia directo al servidor
  // (via el Proxy) si algun documento de caja de pruebas anteriores no tenia el campo fecha,
  // pisando la fecha real con un string vacio ANTES de que cualquier otra logica corriera.
  if (DB.caja.fecha === undefined || DB.caja.fecha === null) DB.caja.fecha = '';
  
  if (!DB.historialVentas) DB.historialVentas = [];
  // Migrate DB.ventas into historialVentas if historialVentas is empty but ventas has data
  if (DB.historialVentas.length === 0 && DB.ventas && DB.ventas.length > 0) {
    DB.historialVentas = DB.ventas.map(v => ({
      ...v,
      origen: v.origen || 'pos',
      estado: v.estado || 'completado',
      estadoStock: 'descontado'
    }));
  }
  _fbPatchColsOp.forEach(col => {
    let _val = DB[col];
    Object.defineProperty(DB, col, {
      get() { return _val; },
      set(v)  {
        _val = v;
        // Nunca guardar arrays vacíos — protege contra sobreescritura accidental
        if (Array.isArray(v) && v.length === 0) return;
        // CAUSA REAL del badge trabado: fbGuardar() poda historialVentas/movimientos
        // reasignándolos (DB.historialVentas = DB.historialVentas.filter(...)) — .filter()
        // siempre crea un array nuevo, así que esa reasignación disparaba este mismo set()
        // de nuevo, que volvía a llamar fbGuardar(), que volvía a podar, sin parar nunca.
        // Si ya hay un guardado en curso, no hace falta encadenar otro — el que está
        // corriendo ya va a incluir este cambio.
        if (_fbEscribiendo) return;
        fbGuardar();
      },
      configurable: true
    });
  });
  _fbPatchColsProd.forEach(col => {
    let _val = DB[col];
    Object.defineProperty(DB, col, {
      get() { return _val; },
      set(v)  {
        _val = v;
        if (Array.isArray(v) && v.length === 0) return;
        // Misma protección preventiva que en _fbPatchColsOp — si fbGuardarProductos() alguna
        // vez reasigna productos/categorias (poda, etc.), esto evita el mismo ciclo infinito.
        if (_fbEscribiendo) return;
        fbGuardarProductos();
      },
      configurable: true
    });
  });
}

function aplicarNombreNegocio() {
  const nombre = (DB.config && DB.config.nombre) || 'Tienda Aleze';
  document.title = nombre;
  const el1 = document.getElementById('brand-nombre-1'); if (el1) el1.textContent = nombre;
  const el2 = document.getElementById('brand-nombre-2'); if (el2) el2.textContent = nombre;
  const el3 = document.getElementById('header-nombre');  if (el3) el3.textContent = nombre;
}

