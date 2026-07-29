// ===================== DATOS =====================
// Nombres visibles enmascarados — nadie que vea la pantalla de login o el nombre de
// "cajero" en un ticket sabe quien es realmente cada persona. "Aleze" = admin, "Aleze N" =
// vendedor N en el orden en que se fueron sumando (Aleze I = primer vendedor, etc.).
// La contraseña real de cada usuario vive SOLO en Firebase Authentication, gestionada
// directamente ahí — nunca en el código ni en Firestore. doLogin() autentica con
// signInWithEmailAndPassword() usando lo que la persona tipea en el momento, contra Firebase
// mismo — nunca compara contra nada guardado localmente. Antes existía una constante PASSWORDS
// acá que no participaba en esa autenticación real (era codigo muerto, con valores de relleno
// que nunca se comparaban contra nada) — eliminada para no dejar ni la apariencia de que el
// sistema maneja contraseñas por su cuenta.

// Mapeo nombre visible → correo Firebase Auth (para reglas de seguridad Firestore). Este es el
// respaldo de emergencia que usa fbPatchDB() SOLO si DB.config.usuariosStaff llega vacio desde
// el servidor — la fuente real, editable, sigue siendo Configuración → Usuarios.
const FIREBASE_USERS = {
  'Aleze':     'tiendaaleze@gmail.com',    // admin (antes "Jose Carlos")
  'Aleze I':   'sharote1212@gmail.com',    // vendedor 1, Sede I (antes "Shessira")
  'Aleze II':  'joselezama.rom@gmail.com', // vendedor 2, Sede I (antes "José Luis")
  'Aleze III': 'sccp.jlezama@gmail.com'    // vendedor 3, Sede II (antes "Betty")
};
// Las contraseñas guardadas en Firestore se cargan en fbEscuchar/onload y sobreescriben estas
let currentUser = null;
let currentRole = null;
let currentUserSedeId = null; // Fase 1 arquitectura multi-sede — sedeId del cajero logueado

// ── Clientes offline-seguro: mismo Proxy que caja/stock, pero por CLIENTE, no por sede ──
// (la deuda de un cliente es con el negocio completo — ya se confirmó, no hace falta separar).
// Solo 5 puntos de entrada real (3 altas + 2 cargas de Firestore) necesitan envolver; las 18
// mutaciones existentes (cli.deuda = X, etc.) quedan cubiertas solas, sin tocarlas.
const _CLIENTE_CAMPOS_INCREMENTALES = ['deuda', 'compras', 'total', 'puntos'];
const _clienteProxiesCreados = new WeakSet();
function fbAjustarCliente(id, campo, delta) {
  if (!dbModular || id == null || !delta) return; // [SDK modular]
  _sincIniciar('cliente', id);
  setDocM(docM(dbModular, 'clientes', String(id)),
    { [campo]: incrementM(delta) },
    { merge: true }
  ).then(() => _sincTerminar('cliente', id))
   .catch(e => _sincError('cliente', id, e, 'los datos del cliente (puntos/deuda/compras)'));
}
function fbSincronizarClienteCampo(id, campo, valor) {
  if (!dbModular || id == null) return; // [SDK modular]
  _sincIniciar('cliente', id);
  setDocM(docM(dbModular, 'clientes', String(id)), { [campo]: valor }, { merge: true })
    .then(() => _sincTerminar('cliente', id))
    .catch(e => _sincError('cliente', id, e, 'los datos del cliente'));
}
// Interruptor para cuando una operación ya sincronizó el cliente vía su propio lote atómico
// (venta, fiado, pago, canje...) — evita que el Proxy dispare SU PROPIA escritura independiente
// encima de lo que el lote ya escribió. Caja tenía este mismo mecanismo antes y se sacó por
// completo (ver _cajaSedeEnvuelta) — acá se mantiene porque el Proxy de cliente sigue siendo
// necesario para otros usos (edición directa desde Clientes, no solo transacciones).
// Sin esto, deuda/puntos/compras/total de CUALQUIER cliente con transacciones se duplicaban en
// Firestore en cada venta o fiado — la escritura del lote, más la del Proxy encima.
let _clienteProxySkipSync = false;
function _envolverCliente(c) {
  if (!c || _clienteProxiesCreados.has(c)) return c;
  const proxy = new Proxy(c, {
    set(target, prop, value) {
      if (_clienteProxySkipSync) { target[prop] = value; return true; }
      if (_CLIENTE_CAMPOS_INCREMENTALES.includes(prop) && typeof value === 'number' && typeof target[prop] === 'number') {
        const delta = Math.round((value - target[prop]) * 100) / 100;
        target[prop] = value;
        if (delta !== 0) fbAjustarCliente(target.id, prop, delta);
      } else {
        target[prop] = value;
        fbSincronizarClienteCampo(target.id, prop, value);
      }
      return true;
    }
  });
  _clienteProxiesCreados.add(proxy);
  return proxy;
}
function _envolverTodosClientes() {
  if (Array.isArray(DB.clientes)) DB.clientes = DB.clientes.map(c => _envolverCliente(c));
}

// ── Sede administrativa (más allá de offline): sede 2 no tiene admin propio, así que el admin
// necesita poder operar (boletas, mermas, productos nuevos, gastos, caja) para cualquier sede
// sin que eso cambie currentUserSedeId — sus VENTAS siguen siendo de su sede física real.
let _sedeAdminOverride = null;
function sedeAdminEfectiva() {
  if (currentRole === 'admin' && _sedeAdminOverride) return _sedeAdminOverride;
  return currentUserSedeId || 'principal';
}
// Promo por sede: liquidar stock concentrado en un local sin forzar traslado innecesario.
// sedeId vacio = todas las sedes (default, compatible con promos ya creadas).
function _promoAplicaSede(promo, sede) {
  return !promo.sedeId || promo.sedeId === sede;
}
// ── Fidelización: puntos ganados por ítem, respetando el multiplicador de su categoría ──
// (categorías sin multiplicadorPuntos configurado usan 1x — no rompe nada existente).
function calcularPuntosGanados(items) {
  if (!items || !items.length) return 0;
  const tasaBase = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaBase) || 1;
  const total = items.reduce((s, item) => {
    const prod = DB.productos.find(p => p.id === item.prodId);
    const cat = prod ? DB.categorias.find(c => c.id === prod.cat) : null;
    const mult = (cat && cat.multiplicadorPuntos) || 1;
    return s + ((item.precio || 0) * (item.cant || 0) * tasaBase * mult);
  }, 0);
  return Math.floor(total);
}

// ── Fidelización: estado de progreso para un cliente — 3 estados, no siempre se muestra ──
// 'lejos' = silencio (no abruma). 'cerca' = dentro de la ventana de aviso, se muestra progreso
// sin revelar el valor en soles. 'premio_disponible' = ya cruzó el umbral, aviso fuerte + acción.
function estadoFidelizacion(clienteId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (!cli) return { estado: 'sin_cliente' };
  const saldo = cli.puntos || 0;
  const premios = [...(DB_EXT.premiosFidelizacion || [])].sort((a, b) => a.puntos - b.puntos);
  const disponibles = premios.filter(p => p.puntos <= saldo);
  if (disponibles.length) {
    return { saldo, estado: 'premio_disponible', premio: disponibles[disponibles.length - 1] };
  }
  const siguiente = premios.find(p => p.puntos > saldo);
  if (!siguiente) return { saldo, estado: 'lejos' }; // sin premios configurados aun, o ninguno alcanzable
  const ventana = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.ventanaAviso) || 300;
  const faltan = siguiente.puntos - saldo;
  if (faltan <= ventana) return { saldo, estado: 'cerca', faltan, premio: siguiente };
  return { saldo, estado: 'lejos' };
}

// ── Fidelización: colección propia para canjes, mismo patrón que boletas/fiados/mermas ──

// Todos los premios que el saldo actual alcanza a cubrir — no solo el más caro (para elegir).
function premiosDisponibles(clienteId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (!cli) return [];
  const saldo = cli.puntos || 0;
  return [...(DB_EXT.premiosFidelizacion || [])].filter(p => p.puntos <= saldo).sort((a,b) => a.puntos - b.puntos);
}

// ── Procesa un canje: descuenta puntos, registra el canje, y refleja el costo real donde
// corresponde — producto → merma (stock baja, costo ya afecta rentabilidad automático, mismo
// mecanismo que cualquier otra merma); descuento → reduce el total de la venta actual, así
// queda dentro del ingreso real de la venta, sin cuenta aparte que alguien tenga que cuadrar.
async function procesarCanje(clienteId, premioId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  const premio = (DB_EXT.premiosFidelizacion || []).find(p => p.id === premioId);
  if (!cli || !premio) { alert('No se pudo procesar el canje.'); return null; }
  if ((cli.puntos || 0) < premio.puntos) { alert('El cliente ya no tiene suficientes puntos para este premio.'); return null; }

  // Mitigación de doble-canje entre 2 dispositivos: verifica el saldo REAL en el servidor
  // justo antes de confirmar — reduce la ventana de riesgo al tiempo de esta consulta, no a
  // toda la sesión. No es una transacción (rompería el trabajo offline ya hecho) — si no hay
  // conexión, sigue con el chequeo local, igual que antes de este fix.
  if (dbModular) { // [SDK modular]
    try {
      const doc = await getDocM(docM(dbModular, 'clientes', String(clienteId)));
      if (doc.exists()) { // en modular, exists es un METODO, no una propiedad
        const saldoReal = doc.data().puntos || 0;
        if (saldoReal < premio.puntos) {
          alert(`⚠️ El saldo de este cliente cambió (probablemente ya se procesó un canje desde otro dispositivo). Saldo actual: ${saldoReal} puntos — no se completó este canje.`);
          return null;
        }
      }
    } catch(e) {
      console.warn('procesarCanje: no se pudo verificar el saldo en el servidor, continuando con el valor local', e);
    }
  }

  const sede = sedeAdminEfectiva();
  const canje = {
    id: getId(), clienteId, fecha: today(), hora: nowTime(),
    premioId: premio.id, premioNombre: premio.nombre, puntosUsados: premio.puntos,
    tipo: premio.tipo, staff: currentUser, sedeId: sede
  };

  // Paquete atomico: puntos descontados, canje registrado, y si aplica la merma del producto
  // premio, viajan juntos — sin esto podian perderse puntos de un cliente sin que quedara
  // registro del canje (o al reves), exactamente el riesgo de fidelizacion duplicada descrito.
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return null; } // [SDK modular]
  const batch = writeBatchM(dbModular);
  let _merma = null, _prodPremio = null;

  if (premio.tipo === 'producto' && premio.prodId) {
    const prod = DB.productos.find(p => p.id === premio.prodId);
    if (prod) {
      batch.set(docM(dbModular, 'stock', String(prod.id)),
        { [`stockPorSede.${sede}`]: incrementM(-1) }, { merge: true });
      _merma = {
        id: getId(), prodId: prod.id, cant: 1, motivo: 'Canje de fidelización',
        obs: `Canje: ${premio.nombre} — ${getClienteNombre(clienteId)}`,
        fecha: today(), usuario: currentUser, sedeId: sede
      };
      batch.set(docM(dbModular, 'mermas', String(_merma.id)), _merma);
      canje.prodId = prod.id;
      canje.costoAsociado = prod.costo || 0;
      _prodPremio = prod;
    }
  } else if (premio.tipo === 'descuento') {
    canje.montoDescuento = premio.monto || 0;
  }

  batch.set(docM(dbModular, 'canjes', String(canje.id)), canje);
  batch.set(docM(dbModular, 'clientes', String(clienteId)), {
    puntos: incrementM(-premio.puntos)
  }, { merge: true });

  _sincIniciar('canje_lote', canje.id);
  try {
    await batch.commit();
    _sincTerminar('canje_lote', canje.id);
  } catch (e) {
    _sincError('canje_lote', canje.id, e, 'el canje de fidelización — no se aplicó nada, los puntos siguen intactos');
    return null;
  }

  if (_prodPremio && _merma) {
    if (!_prodPremio.stockPorSede) _prodPremio.stockPorSede = { principal: _prodPremio.stock||0 };
    _prodPremio.stockPorSede[sede] = Math.max(0, Math.round(((_prodPremio.stockPorSede[sede]||0)-1)*1000)/1000);
    _prodPremio.stock = stockTotal(_prodPremio);
    DB.mermas.push(_merma);
  }
  if (premio.tipo === 'descuento') {
    const descInput = document.getElementById('pos-descuento'); // campo unico, compartido entre desktop y movil
    if (descInput) descInput.value = (parseFloat(descInput.value) || 0) + canje.montoDescuento;
  }
  // El lote ya escribió esto en Firestore — el interruptor evita que el Proxy del cliente
  // dispare su propia escritura encima (mismo riesgo que ya se corrigió en caja).
  _clienteProxySkipSync = true;
  try { cli.puntos = (cli.puntos || 0) - premio.puntos; } finally { _clienteProxySkipSync = false; }
  fbGuardar();
  fbGuardarProductos();
  return canje;
}

// Cambiar de sede es un cambio de CONTEXTO COMPLETO — no solo dónde se crean registros
// nuevos (boletas, mermas, gastos, caja), también qué se está VIENDO en reportes, historial
// e inventario. Antes solo tocaba lo primero, lo que hacía parecer que "no pasaba nada" al
// cambiar. Ahora sincroniza los filtros de sede propios de cada pantalla y refresca lo que
// esté activo, con confirmación explícita antes de aplicar (no es un cambio menor).
function cambiarSedeAdmin(sede) {
  const _sedeAnterior = _sedeAdminOverride;
  const _nombreSede = s => s === 'principal' || !s ? 'Sede I (Principal)' : 'Sede II (Tienda Aleze II)';

  if (!confirm(`¿Cambiar a ${_nombreSede(sede)}?\n\nEsto cambia dónde se registran boletas, mermas, gastos y caja, Y qué estás viendo en reportes, historial e inventario — todo el contexto de la sesión.`)) {
    // Revertir el selector visualmente si cancela — el <select> ya cambió de valor al disparar onchange.
    const sel = document.getElementById('sede-admin-selector');
    if (sel) sel.value = _sedeAnterior || '';
    return;
  }

  _sedeAdminOverride = sede || null;
  const sedeEfectiva = sedeAdminEfectiva();

  // Sincronizar los filtros de sede propios de cada pantalla — así, aunque el usuario
  // navegue a otra sección después, ya la encuentra filtrada a la sede correcta.
  ['rep-sede', 'hv-sede'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = sedeEfectiva;
  });

  try {
    const activePage = document.querySelector('.page.active');
    const pageId = activePage ? activePage.id.replace('page-','') : '';
    const _refrescos = {
      'dashboard': renderDashboard,
      'caja': renderCaja,
      'reportes': generarReporte,
      'historial-ventas': renderHistorialVentas,
      'inventario': renderInvTable,
      'mermas': renderMermas,
      'gastos': renderGastos,
      'fiados': renderFiados,
      'pos': () => { try { renderPos(); } catch(e){} try { if (isMobile()) renderMobPos(); } catch(e){} },
      'frecuentes': renderFrecuentes,
    };
    if (_refrescos[pageId]) _refrescos[pageId]();
  } catch(e) { console.warn('cambiarSedeAdmin: error al refrescar la vista', e); }

  // Aviso posterior, breve — confirma que el cambio se aplicó de verdad, no solo el selector.
  setTimeout(() => alert(`✅ Ahora estás en ${_nombreSede(sede)} — vista y registros nuevos aplican a esta sede.`), 100);
}

// Extended DB with new modules
const DB_EXT = {
  sueldos: {'Jose Carlos':0,'Shessira':0,'José Luis':0},
  navidad: {n:3, valor:50},
  // ── Fidelización (puntos canjeables) — vive junto a niveles por ahora, sin tocarlo.
  // tasaBase: puntos por sol gastado. ventanaAviso: cuántos puntos antes del premio se avisa
  // ("cerca"), para no abrumar con el aviso en cada venta. premios: lista configurable.
  fidelizacion: { tasaBase: 1, ventanaAviso: 300 },
  premiosFidelizacion: [],
  niveles: [
    {umbral:100, max:1, desc:'Nivel 1 — hasta S/1'},
    {umbral:250, max:3, desc:'Nivel 2 — hasta S/3'},
    {umbral:500, max:5, desc:'Nivel 3 — hasta S/5'},
    {umbral:1000, max:20, desc:'Nivel 4 — hasta S/20'}
  ],
 capital: {total:0, cuota:0, meta:0, recuperado:0, prestamo:0, prestamoPagado:0, hist:[]},
  gastos: [],
  gastosRec: [
    {id:1, desc:'Energía eléctrica mensual', tipo:'Energía', monto:80},
    {id:2, desc:'Transporte de mercadería', tipo:'Transporte', monto:50}
  ]
};

let DB = {
  categorias: [
    { id: 1, nombre: 'Bebidas', emoji: '🥤' },
    { id: 2, nombre: 'Snacks', emoji: '🍿' },
    { id: 3, nombre: 'Lácteos', emoji: '🥛' },
    { id: 4, nombre: 'Abarrotes', emoji: '🛒' },
    { id: 5, nombre: 'Higiene', emoji: '🧴' },
    { id: 6, nombre: 'Panadería', emoji: '🍞' },
  ],
  productos: [
    { id: 1, nombre: 'Inca Kola 500ml', cat: 1, tipo: 'unidad', unidad: 'und', costo: 1.20, precio: 2.00, stock: 48, stockMin: 10, venc: '2026-08-15', codigo: '7500000001', prov: 1 },
    { id: 2, nombre: 'Gaseosa Sprite 1.5L', cat: 1, tipo: 'unidad', unidad: 'und', costo: 3.50, precio: 5.50, stock: 24, stockMin: 6, venc: '2026-09-01', codigo: '7500000002', prov: 1 },
    { id: 3, nombre: 'Papas Lay\'s Classic', cat: 2, tipo: 'unidad', unidad: 'und', costo: 0.80, precio: 1.50, stock: 60, stockMin: 15, venc: '2026-05-28', codigo: '7500000003', prov: 2 },
    { id: 4, nombre: 'Leche Gloria 1L', cat: 3, tipo: 'unidad', unidad: 'und', costo: 3.20, precio: 4.50, stock: 3, stockMin: 8, venc: '2026-06-10', codigo: '7500000004', prov: 3 },
    { id: 5, nombre: 'Arroz Costeño 1kg', cat: 4, tipo: 'granel', unidad: 'kg', costo: 2.80, precio: 4.00, stock: 50, stockMin: 10, venc: '', codigo: '7500000005', prov: 4 },
    { id: 6, nombre: 'Jabón Neko', cat: 5, tipo: 'unidad', unidad: 'und', costo: 1.00, precio: 1.80, stock: 4, stockMin: 5, venc: '', codigo: '7500000006', prov: 5 },
    { id: 7, nombre: 'Pan de molde Bimbo', cat: 6, tipo: 'unidad', unidad: 'und', costo: 5.00, precio: 7.50, stock: 8, stockMin: 4, venc: '2026-05-24', codigo: '7500000007', prov: 6 },
  ],
  proveedores: [
    { id: 1, nombre: 'Distribuidora Coca-Cola', contacto: 'Pedro Sánchez', tel: '999001001', productos: 'Bebidas gaseosas' },
    { id: 2, nombre: 'Snacks del Perú SAC', contacto: 'María López', tel: '999002002', productos: 'Snacks y golosinas' },
    { id: 3, nombre: 'Gloria S.A.', contacto: 'Distribución', tel: '999003003', productos: 'Lácteos' },
    { id: 4, nombre: 'Costeño Alimentos', contacto: 'Ventas', tel: '999004004', productos: 'Abarrotes' },
    { id: 5, nombre: 'P&G Distribuciones', contacto: 'Luis Torres', tel: '999005005', productos: 'Higiene' },
    { id: 6, nombre: 'Bimbo Perú', contacto: 'Reparto', tel: '999006006', productos: 'Panadería' },
  ],
  clientes: [],
  ventas: [],
  fiados: [],
  mermas: [],
  promociones: [],
  movimientos: [],
 config: { nombre: 'Tienda Aleze', direccion: 'Jr. Tigrillo Mz. Ll4 Lt. 5 Asoc. Percin Deza SJL', telefono: '', ticketMsg: '¡Gracias por su compra!', diasVenc: 7, whatsappTienda: '980037284', montoAperturaAuto: 0, eslogan: 'Todo lo que necesitas, cerca de ti', bannerUrl: '', bannerLink: '', bannerVisible: true, usuariosStaff: [], tiendasExternas: [{id:'efe',nombre:'Tienda Efe',imagen:'',url:'',visible:true,waCatalogo:false},{id:'curacao',nombre:'Curacao',imagen:'',url:'',visible:true,waCatalogo:false},{id:'juntoz',nombre:'Juntoz',imagen:'',url:'',visible:true,waCatalogo:false},{id:'bata',nombre:'Bata',imagen:'',url:'',visible:true,waCatalogo:true}], serviciosWa: [{id:'impresiones',nombre:'Impresiones y copias',emoji:'🖨️',visible:true},{id:'recargas',nombre:'Recargas celular',emoji:'📱',visible:true},{id:'pagos',nombre:'Pago de servicios',emoji:'💡',visible:true},{id:'escaneos',nombre:'Escaneos',emoji:'📋',visible:true}], serviciosBannerUrl: '', tiendasTexto: '', alertasIgnoradas: {},
   // Verificacion SMS de telefono en tienda publica: construida como flag apagado a
   // proposito. Hoy el telefono identifica al cliente (tndResolverCliente), pero no lo
   // verifica. Cuando exista pasarela de pago real, este flag pasa a true y el flujo de
   // verificacion (Firebase Phone Auth, pendiente de implementar) se vuelve obligatorio
   // antes de pedir o ver puntos, no solo un dato que cualquiera puede escribir.
   requiereVerificacionSMS: false,
   // Pasarela de pago (Izipay) — construida dormida a proposito. La activacion real requiere
   // desplegar las Cloud Functions en /functions (no se despliegan solas, alguien lo hace
   // manualmente con `firebase deploy --only functions`) y cargar las llaves secretas ahi,
   // nunca en Firestore. Mientras pasarelaPago.activa sea false, el checkout de la tienda
   // sigue exactamente igual que hoy (WhatsApp + Yape/Plin confirmado a mano).
   pasarelaPago: { activa: false, proveedor: 'izipay', llavePublica: '' }
  },
  _cajas: { principal: { abierta: false, inicial: 0, ingresos: 0, egresos: 0, turnoInicio: null, cajero: '', fecha: '' } },
  historialVentas: [],
  pedidosOnline: []
};

// ── Caja por sede — mismo patrón que inventario: objeto plano, escritura SIEMPRE explícita
// dentro del propio lote/transacción de cada función, nunca automática en segundo plano.
// ANTES había un Proxy acá que escribía a Firestore por su cuenta cada vez que se le asignaba
// un campo (DB.caja.ingresos = X, etc.) — y dependía de que cada una de las 20+ funciones que
// tocan caja se acordara de desactivarlo antes de aplicar localmente lo que su propio lote ya
// había escrito. Bastaba con que UNA se olvidara para duplicar el dinero — y así fue: 6
// funciones distintas tenían exactamente ese olvido. Ahora es estructuralmente imposible que
// vuelva a pasar: no hay nada escuchando la asignación, así que no hay nada que pueda escribir
// por sorpresa. Cada función sigue escribiendo a Firestore explícitamente, como siempre lo
// hizo — lo único que cambia es que la copia local ya no dispara una segunda escritura sola.
function _cajaSedeEnvuelta(sede) {
  if (!DB._cajas[sede]) {
    DB._cajas[sede] = { abierta: false, inicial: 0, ingresos: 0, egresos: 0, turnoInicio: null, cajero: '', fecha: '' };
  }
  return DB._cajas[sede];
}
Object.defineProperty(DB, 'caja', {
  get() {
    return _cajaSedeEnvuelta(sedeAdminEfectiva());
  },
  set(v) {
    // Reasignación completa (abrir/cerrar caja) — la escritura a Firestore ya la hizo, de
    // forma explícita, la función que llama (dentro de su propio lote o transacción). Esto
    // solo actualiza la copia local, igual que "prod.stockPorSede[sede] = X" en inventario.
    DB._cajas[sedeAdminEfectiva()] = v;
  },
  configurable: true
});

let cart = [];

// ===================== RESET DE ESTADO GLOBAL =====================
// Se ejecuta SIEMPRE antes de login y en logout.
// Garantiza que ninguna sesión anterior contamine la nueva.
function resetAppState() {
  currentUser = null;
  currentRole = null;
  currentUserSedeId = null;
  cart = [];
  _fbProdCacheTs = 0;

  // Limpiar campos operativos en memoria SIN disparar fbGuardar a Firebase.
  // fbPatchDB instala setters con configurable:true — redefinimos el campo
  // con Object.defineProperty apuntando directamente al nuevo _val vacío,
  // para no activar el setter original que llamaría fbGuardar().
  const _vaciarCampo = (key, emptyVal) => {
    const desc = Object.getOwnPropertyDescriptor(DB, key);
    if (desc && typeof desc.set === 'function') {
      // Setter activo: re-definir con el mismo patrón pero nuevo _val
      let _val = emptyVal;
      Object.defineProperty(DB, key, {
        get() { return _val; },
        set(v) { _val = v; key === 'productos' || key === 'categorias' ? fbGuardarProductos() : fbGuardar(); },
        configurable: true,
        enumerable: true
      });
    } else {
      DB[key] = emptyVal;
    }
  };

  // Solo campos operativos — productos/categorías NO se tocan
  _vaciarCampo('ventas', []);
  _vaciarCampo('clientes', []);
  _vaciarCampo('fiados', []);
  _vaciarCampo('mermas', []);
  _vaciarCampo('movimientos', []);
  _vaciarCampo('proveedores', []);
  _vaciarCampo('promociones', []);
try { Object.defineProperty(DB, 'pedidosOnline', { value: [], writable: true, configurable: true, enumerable: true }); } catch(e) { DB.pedidosOnline = []; }
  _vaciarCampo('historialVentas', []);

  // caja y config: asignación directa (no están en el patch de setters)
  DB.caja = { abierta: false, inicial: 0, ingresos: 0, egresos: 0, turnoInicio: null, cajero: '', fecha: '' };
  // config NO se resetea — se preserva el valor cargado desde Firebase

  // Ocultar nav de admin si quedó visible
  const adminNav = document.getElementById('admin-nav');
  if (adminNav) adminNav.style.display = '';
}

let editingProductId = null;
let editingFiadoId = null;
const _fiadosAbiertos = new Set();
let chartVentas = null, chartMetodos = null, chartReporte = null;
let posFilterCat = '';
// scannerStream eliminado — html5-qrcode gestiona su propio stream

// ===================== NAVIGATION =====================
// ── FASE 3.2: Cart Drawer Desktop ───────────────────────────────────────────
function abrirCartDrawer() {
  document.getElementById('pos-cart-panel').classList.add('drawer-open');
  document.getElementById('pos-cart-overlay').classList.add('visible');
}

function cerrarCartDrawer() {
  document.getElementById('pos-cart-panel').classList.remove('drawer-open');
  document.getElementById('pos-cart-overlay').classList.remove('visible');
}

// Actualiza el badge del botón 🛒 desktop y lanza animación pulse
function updatePosCartBadge() {
  const badge = document.getElementById('pos-cart-badge');
  if (!badge) return;
  const total = cart.reduce((s, i) => s + i.cant, 0);
  badge.textContent = total;
  if (total > 0) {
    badge.classList.remove('pulse');
    void badge.offsetWidth; // forzar reflow para reiniciar animación
    badge.classList.add('pulse');
  }
}

async function navigate(page) {
  // CRITICO: checkAutoAbrirCaja() ahora es async (espera a ensureCajaAbierta(), que a su vez
  // espera una lectura real al servidor) — sin este await, renderCaja()/renderDashboard() de
  // abajo pintaban con el estado de un instante antes, y el estado real recien se veia al
  // volver a navegar o actualizar manualmente.
  await checkAutoAbrirCaja();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) { console.warn('navigate: página no encontrada →', page); return; }
  pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + page + "'")) n.classList.add('active');
  });
  if (page === 'dashboard') renderDashboard();
  if (page === 'pos') {
    // Aviso bloqueante: si el admin sigue "operando" en una sede distinta a la de su login,
    // conviene confirmarlo antes de vender — evita vender en Sede II sin darse cuenta porque
    // quedó así después de revisar algo y se olvidó de volver a su sede.
    if (currentRole === 'admin' && _sedeAdminOverride && sedeAdminEfectiva() !== currentUserSedeId) {
      const _nombreSedeAct = sedeAdminEfectiva() === 'principal' ? 'Sede I (Principal)' : 'Sede II (Tienda Aleze II)';
      const _volverAMiSede = confirm(`⚠️ Estás vendiendo en ${_nombreSedeAct} — no es tu sede de inicio de sesión.\n\nAceptar: volver a mi sede antes de continuar.\nCancelar: seguir vendiendo en ${_nombreSedeAct} (si estás físicamente ahí).`);
      if (_volverAMiSede) {
        _sedeAdminOverride = null;
        const _selSede = document.getElementById('sede-admin-selector');
        if (_selSede) _selSede.value = '';
      }
    }
    if (dbModular && DB.productos.length === 0) { // [SDK modular]
      getDocM(docM(dbModular, 'aleze', 'db_productos')).then(snap => {
        if (snap.exists()) { // en modular, exists es un METODO, no una propiedad
          const pd = snap.data();
          if (pd.productos)  DB.productos  = pd.productos;
          if (pd.categorias) DB.categorias = pd.categorias;
          if (pd.config)     DB.config = { ...DB.config, ...pd.config };
        }
        // Fase Offline: stock más fresco, mismo criterio que en el login.
        return getDocsM(collectionM(dbModular, 'stock')).then(stockSnap => { // [SDK modular]
          stockSnap.forEach(doc => {
            const prod = DB.productos.find(p => String(p.id) === doc.id);
            const d = doc.data();
            if (prod && d && d.stockPorSede) { prod.stockPorSede = d.stockPorSede; prod.stock = stockTotal(prod); }
          });
        }).catch(() => {});
      }).then(() => {
        renderPos(); if (isMobile()) renderMobPos();
      }).catch(() => { renderPos(); if (isMobile()) renderMobPos(); });
    } else {
      renderPos(); if (isMobile()) renderMobPos();
    }
  }
  if (page === 'inventario') renderInventario();
  if (page === 'categorias') renderCategorias();
  if (page === 'proveedores') renderProveedores();
  if (page === 'clientes') renderClientes();
  if (page === 'frecuentes') renderFrecuentes();
  if (page === 'fiados') renderFiados();
  if (page === 'caja') renderCaja();
  if (page === 'promociones') renderPromociones();
  if (page === 'mermas') renderMermas();
  if (page === 'gastos') renderGastos();
  if (page === 'capital') renderCapital();
  if (page === 'reportes') initReportes();
  if (page === 'configuracion') renderConfiguracion();
  if (page === 'historial-ventas') renderHistorialVentas();
  if (page === 'pedidos-online') renderPedidosOnline();
  // Close mobile sidebar on navigation
  closeMobSidebar();
  // Asegurar que el overlay del drawer no quede visible al cambiar de página
  const cartOverlay = document.getElementById('pos-cart-overlay');
  if (cartOverlay) cartOverlay.classList.remove('visible');
  // Cerrar drawer unificado al salir del POS
  if (page !== 'pos') {
    try { cerrarCartDrawer(); } catch(e) {}
  }
  // Layout resuelto por CSS (dvh + height fijo) — sin paddingBottom dinámico
}
function _norm(s) {
  return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
// ===================== UTILS =====================
function sol(n) { return 'S/ ' + parseFloat(n || 0).toFixed(2); }
function today() {
  // Usar zona horaria de Lima (America/Lima = UTC-5) para evitar desfase nocturno
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}
function nowTime() { return new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(d) { if (!d) return '-'; const [y,m,dd] = d.split('-'); return dd+'/'+m+'/'+y; }
function diasHasta(fecha) { if (!fecha) return 9999; return Math.ceil((new Date(fecha) - new Date()) / 86400000); }
// CRITICO: antes esto era Date.now() + random(9999) — dos llamadas dentro del MISMO
// milisegundo (real dentro de un bucle sincronico, como varias mermas seguidas al sincronizar
// un conteo de inventario) tenian una probabilidad real, aunque baja, de devolver el mismo
// numero, pisando un registro con otro en la misma coleccion. El contador da hasta 1000 IDs
// unicos POR MILISEGUNDO (1 millon por segundo) antes de repetir — muy por encima de
// cualquier bucle real de esta app — y se mantiene dentro del rango entero seguro de
// JavaScript por décadas. Sigue siendo numerico y creciente con el tiempo (mas nuevo = numero
// mas grande), no rompe ningun orden ni comparacion existente.
let _getIdContador = 0;
function getId() {
  _getIdContador = (_getIdContador + 1) % 1000;
  return Date.now() * 1000 + _getIdContador;
}
function getCategoriaNombre(id) {
  const c = DB.categorias.find(c => c.id == id);
  if (!c) return '-';
  const icon = c.imagen ? `<img src="${c.imagen}" style="width:18px;height:18px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:3px"/>` : (c.emoji+' ');
  return icon + c.nombre;
}
function getProveedorNombre(id) { const p = DB.proveedores.find(p => p.id == id); return p ? p.nombre : '-'; }
function getClienteNombre(id) { const c = DB.clientes.find(c => c.id == id); return c ? (c.alias||c.nombre) : 'Anónimo'; }
function getMesActual() { return today().substring(0,7); }
function precioSugerido(costo, margen) { return Math.ceil(costo*(1+margen/100)*10)/10; }
function getNivel(totalAnual) { return [...DB_EXT.niveles].sort((a,b)=>b.umbral-a.umbral).find(n=>totalAnual>=n.umbral)||null; }

function getAlertas() {
  const ignoradas = DB.config.alertasIgnoradas || {};
  const alertas = [];
  const diasVenc = parseInt(DB.config.diasVenc) || 7;
  DB.productos.forEach(p => {
    const _stockAqui = stockEnSede(p);
    if (_stockAqui <= p.stockMin) {
      const key = 'stock_' + p.id;
      if (!ignoradas[key]) alertas.push({ tipo:'danger', titulo:'Stock bajo: '+p.nombre, sub:'Stock: '+_stockAqui+' '+p.unidad+' (mín: '+p.stockMin+')', key });
    }
    if (p.venc && diasHasta(p.venc) <= diasVenc && diasHasta(p.venc) >= 0) {
      const key = 'venc_soon_' + p.id;
      if (!ignoradas[key]) alertas.push({ tipo:'warning', titulo:'Vence pronto: '+p.nombre, sub:'Vence el '+formatDate(p.venc)+' ('+diasHasta(p.venc)+' días)', key });
    }
    if (p.venc && diasHasta(p.venc) < 0) {
      const key = 'venc_exp_' + p.id;
      if (!ignoradas[key]) alertas.push({ tipo:'danger', titulo:'VENCIDO: '+p.nombre, sub:'Venció el '+formatDate(p.venc), key });
    }
  });
  // Cumpleaños
  const hd = new Date();
  const _yr = hd.getFullYear();
  DB.clientes.forEach(c => {
    if (!c.cumple) return;
    const [,m,d] = c.cumple.split('-');
    const diff = Math.ceil((new Date(hd.getFullYear(),parseInt(m)-1,parseInt(d)) - hd) / 86400000);
    if (diff === 0) { const key='bday_'+c.id+'_'+_yr; if (!ignoradas[key]) alertas.push({tipo:'success', titulo:'🎂 ¡Hoy cumple '+(c.alias||c.nombre)+'!', sub:'Recuerda el detalle especial (S/5-10)', key}); }
    else if (diff === 1) { const key='bday1_'+c.id+'_'+_yr; if (!ignoradas[key]) alertas.push({tipo:'info', titulo:'🎂 Mañana cumple '+(c.alias||c.nombre), sub:'Prepara el regalo', key}); }
    else if (diff === 2) { const key='bday2_'+c.id+'_'+_yr; if (!ignoradas[key]) alertas.push({tipo:'info', titulo:'🎂 En 2 días cumple '+(c.alias||c.nombre), sub:'Anticipa el detalle', key}); }
  });
 DB.fiados.forEach(f => {
  // Saneamos la visualización y validación del saldo para eliminar decimales huérfanos
  const pendiente = Math.round((f.total - f.pagado) * 100) / 100;
  if (pendiente > 0) {
    const key = 'fiado_' + f.id + '_' + pendiente;
    if (!ignoradas[key]) alertas.push({ tipo:'info', titulo:'Fiado pendiente: '+getClienteNombre(f.clienteId), sub:'Debe '+sol(pendiente), key });
  }
});
  return alertas;
}

function updateAlertCount() {
  const count = getAlertas().length;
  document.getElementById('alert-count').textContent = count;
  document.getElementById('alert-count').style.background = count > 0 ? 'var(--danger)' : 'var(--accent)';
}

function showAlerts() {
  const alertas = getAlertas();
  const icons = { danger:'🔴', warning:'🟡', info:'🔵', success:'🟢' };
  document.getElementById('modal-alertas-content').innerHTML = alertas.length === 0
    ? '<p style="text-align:center;color:var(--gray-500);padding:1rem">✅ Sin alertas activas</p>'
    : alertas.map(a => `<div class="alert-item ${a.tipo}" style="position:relative;padding-right:2rem">
        <span class="alert-icon">${icons[a.tipo]||'🔵'}</span>
        <div class="alert-text"><strong>${a.titulo}</strong><span>${a.sub}</span></div>
        <button onclick="ignorarAlerta('${a.key}')" title="Ignorar alerta" style="position:absolute;top:.4rem;right:.4rem;background:none;border:none;cursor:pointer;font-size:1rem;color:var(--gray-400);line-height:1">✕</button>
      </div>`).join('');
  abrirModal('modal-alertas');
}
function ignorarAlerta(key) {
  if (!key) return;
  if (!DB.config.alertasIgnoradas) DB.config.alertasIgnoradas = {};
  DB.config.alertasIgnoradas[key] = Date.now();
  fbGuardar();
  fbGuardarProductos();
  showAlerts();
  updateAlertCount();
}

function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }

// ===================== ADVERTENCIA AL RECARGAR =====================
window.addEventListener('beforeunload', function(e) {
  // No mostrar alerta si está instalada como PWA (standalone)
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  const msg = 'La página se está actualizando. Se perderá toda la información no guardada.';
  e.preventDefault();
  e.returnValue = msg;
  return msg;
});

// ===================== FIREBASE CONFIG =====================
// IMPORTANTE: Reemplaza estos valores con los de tu proyecto Firebase.
// ===================== INIT =====================
// CRITICO: antes esto era "window.onload", que espera a que TODA la pagina termine de cargar
// -- incluidas imagenes y otros recursos, no solo el HTML/JS. En una red movil, eso agrega
// segundos antes de que App Check/reCAPTCHA siquiera empiece a generar su primer token — y
// generar ese token (bajar el script de reCAPTCHA + hacer su propia verificacion contra
// Google) tampoco es instantaneo. DOMContentLoaded dispara apenas el HTML/JS termino de
// parsearse, sin esperar imagenes -- le da a App Check varios segundos extra de ventaja para
// terminar mientras el resto de la pagina sigue cargando en paralelo, en vez de arrancar recien
// despues de que todo lo demas ya termino.
document.addEventListener('DOMContentLoaded', async function() {
  const hoy = today();
  const fbOk = await iniciarFirebase();

  if (fbOk) {
    try {
      // Carga inicial pre-login: solo el catálogo público (db_productos).
      // 'db' y 'db_ext' ahora requieren sesión — se cargan en PASO 3 del login.
      const snapProd = await getDocM(docM(dbModular, 'aleze', 'db_productos')); // [SDK modular]

      if (snapProd.exists()) { // en modular, exists es un METODO, no una propiedad
        const pd = snapProd.data();
        if (pd.productos)  DB.productos  = pd.productos;
        if (pd.categorias) DB.categorias = pd.categorias;
        if (pd.config)     DB.config     = { ...DB.config, ...pd.config };
        _fbProdCacheTs = Date.now();
      }
      // Estadísticas reales de la pantalla de bienvenida — contadas del catálogo, no inventadas.
      try {
        const _elProd = document.getElementById('welcome-stat-productos');
        if (_elProd && DB.productos && DB.productos.length) {
          _elProd.textContent = (Math.floor(DB.productos.length / 10) * 10) + '+';
        }
        const _elCat = document.getElementById('welcome-stat-categorias');
        if (_elCat && DB.categorias && DB.categorias.length) {
          _elCat.textContent = DB.categorias.length;
        }
      } catch(e) {}
      // Fase Offline: trae el stock más fresco (colección aparte, puede tener cambios más recientes
      // que el snapshot de arriba si otra sede vendió/ajustó mientras este dispositivo no estaba conectado).
      try {
        const stockSnap = await getDocsM(collectionM(dbModular, 'stock')); // [SDK modular]
        stockSnap.forEach(doc => {
          const prod = DB.productos.find(p => String(p.id) === doc.id);
          const d = doc.data();
          if (prod && d && d.stockPorSede) {
            prod.stockPorSede = d.stockPorSede;
            prod.stock = stockTotal(prod);
          }
        });
      } catch(e) { console.warn('[Offline] No se pudo reconciliar stock fresco:', e); }
      aplicarNombreNegocio();

      _fbLastWriteTs = Date.now();
      fbPatchDB();
      renderLoginDropdown();
      checkRoute();
      if (!window.location.pathname.includes('/tienda') && !window.location.hash.includes('/tienda')) {
        renderDashboard();
        mobUpdateBar();
      }
    } catch(e) {
      console.warn('Firestore no disponible, modo local:', e.message);
      _initLocal(hoy);
    }
  } else {
    _initLocal(hoy);
  }
});


// ===================== ROUTING /tienda vs /admin =====================
function checkRoute() {
  const esTienda = window.__rutaTienda ||
    window.location.pathname.indexOf('/tienda') !== -1 ||
    window.location.hash.indexOf('/tienda') !== -1 ||
    window.location.hash === '#tienda';

  if (esTienda) {
    initTienda();
    return;
  }

  // Shortcut PWA: guardar intent de ruta para resolver post-login
  const hash = window.location.hash;
  if (hash === '#pos' || hash.startsWith('#pos')) {
    window.__pendingRoute = 'pos';
  }

  // Es la ruta admin — mostrar login (ya está visible por earlyRoute)
  // Restaurar bloqueo activo si el usuario recargó la página durante el bloqueo
  const bloqueoTs = parseInt(localStorage.getItem('aleze_bloqueo') || '0');
  if (bloqueoTs > Date.now()) {
    _mostrarBloqueo(bloqueoTs);
  }
}

function _semillaDemo(hoy) {
  DB.ventas = [
    { id:1, fecha:hoy, hora:'09:15', cajero:'Jose Carlos', items:[{prodId:1,nombre:'Inca Kola 500ml',cant:3,precio:2.00,tipo:'unidad'},{prodId:3,nombre:"Papas Lay's",cant:2,precio:1.50,tipo:'unidad'}], subtotal:9.00, descuento:0, total:9.00, metodo:'Efectivo', clienteId:1 },
    { id:2, fecha:hoy, hora:'10:30', cajero:'Shessira', items:[{prodId:4,nombre:'Leche Gloria 1L',cant:2,precio:4.50,tipo:'unidad'}], subtotal:9.00, descuento:0, total:9.00, metodo:'Yape', clienteId:2 },
    { id:3, fecha:hoy, hora:'11:45', cajero:'José Luis', items:[{prodId:5,nombre:'Arroz Costeño',cant:2,precio:4.00,tipo:'granel'}], subtotal:8.00, descuento:0.50, total:7.50, metodo:'Efectivo', clienteId:3 },
  ];
  DB.clientes[0].total=145.50; DB.clientes[0].alias='Doña Ana'; DB.clientes[0].cumple='1985-03-15';
  DB.clientes[1].total=87.00;  DB.clientes[1].alias='Carlos';   DB.clientes[1].cumple='1990-07-22';
  DB.clientes[2].total=230.00; DB.clientes[2].alias='Doña Rosa';DB.clientes[2].cumple='1978-12-01';
}


