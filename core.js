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
  'Aleze I':   'sharote1212@gmail.com',    // vendedor 1 (antes "Shessira")
  'Aleze II':  'joselezama.rom@gmail.com'  // vendedor 2 (antes "José Luis")
};
// Las contraseñas guardadas en Firestore se cargan en fbEscuchar/onload y sobreescriben estas
let currentUser = null;
let currentRole = null;
let currentUserSedeId = null; // Fase 1 arquitectura multi-sede — sedeId del cajero logueado

// ── Clientes offline-seguro: mismo Proxy que caja/stock, pero por CLIENTE ──
// puntos/compras/total/deuda son del cliente completo — con una sola sede, no hay ningun
// motivo para separar la deuda por sede como se hizo antes (esa separacion existia
// especificamente porque 2 cajeros de sedes distintas no se conocian entre si).
const _CLIENTE_CAMPOS_INCREMENTALES = ['compras', 'total', 'puntos', 'deuda'];
const _clienteProxiesCreados = new WeakSet();
// ── Escritura DIRECTA de la identidad de un cliente (nombre/alias/tel/dir/cumple) ──
// CRITICO: reemplaza el patrón anterior de llamar a fbGuardar() al crear/editar un cliente
// desde POS o Clientes — fbGuardar() NUNCA escribió clientes/{id} (solo poda arrays locales y
// guarda config), así que el nombre quedaba SOLO en la memoria del dispositivo que lo creó.
// Cualquier otro dispositivo terminaba viendo el documento real de Firestore, que recién se
// creaba después con la primera venta (compras/total/puntos vía incrementM) — sin el nombre,
// porque esa escritura nunca lo incluye. De ahí "Cliente sin nombre" en otros dispositivos, y
// el riesgo de crear un cliente duplicado porque el nombre real nunca se pudo encontrar.
function _guardarClienteDirecto(id, data, esNuevo) {
  if (!dbModular) { console.warn('_guardarClienteDirecto: sin conexión, este cambio no llegó al servidor'); return; }
  _sincIniciar('cliente_directo', id);
  setDocM(docM(dbModular, 'clientes', String(id)), data, esNuevo ? {} : { merge: true })
    .then(() => _sincTerminar('cliente_directo', id))
    .catch(e => _sincError('cliente_directo', id, e, 'los datos del cliente'));
}

function fbAjustarCliente(id, campo, delta) {
  if (!dbModular || id == null || !delta) return; // [SDK modular]
  _sincIniciar('cliente', id);
  setDocM(docM(dbModular, 'clientes', String(id)),
    { [campo]: incrementM(delta) },
    { merge: true }
  ).then(() => _sincTerminar('cliente', id))
   .catch(e => _sincError('cliente', id, e, 'los datos del cliente (puntos/compras)'));
}
// Reemplaza el patrón "cli.deuda = X" cuando la escritura necesita quedar fuera del Proxy
// (por ejemplo, para disparar la escritura desde una función que ya la calculó a mano).
// Actualiza la memoria local Y dispara la escritura atómica a Firestore.
function ajustarDeudaCliente(cli, delta) {
  if (!cli || !delta) return;
  cli.deuda = Math.max(0, Math.round(((cli.deuda||0) + delta) * 100) / 100);
  fbAjustarCliente(cli.id, 'deuda', delta);
}
// Version "solo memoria" de ajustarDeudaCliente — para cuando un LOTE atomico ya escribio el
// cambio a Firestore (venta, fiado, pago...) y esta funcion solo necesita reflejar lo mismo en
// la copia local, sin disparar una escritura independiente encima (eso duplicaria el ajuste,
// mismo tipo de bug que ya se corrigio para caja con _cajaProxySkipSync).
function _aplicarDeudaLocal(cli, delta) {
  if (!cli || !delta) return;
  cli.deuda = Math.max(0, Math.round(((cli.deuda||0) + delta) * 100) / 100);
}
// Migración defensiva: clientes que todavía traigan el campo viejo deudaPorSede (de cuando
// el negocio operaba con 2 sedes) se convierten de vuelta a un solo campo deuda — sumando lo
// que hubiera en cada sede, para no perder ningún rastro de lo que debían.
function _migrarDeudaClienteSiHaceFalta(cli) {
  if (cli.deudaPorSede) {
    cli.deuda = Object.values(cli.deudaPorSede).reduce((s,v) => s + (v||0), 0);
    delete cli.deudaPorSede;
  }
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
  if (Array.isArray(DB.clientes)) DB.clientes = DB.clientes.map(c => { _migrarDeudaClienteSiHaceFalta(c); return _envolverCliente(c); });
}

// El negocio opera con una sola sede — se mantiene esta funcion (en vez de escribir
// 'principal' literal en cada uno de los cientos de lugares que la llaman) para no tener que
// tocar cada punto de contacto del sistema por separado, con el mismo riesgo de romper algo
// que ya evaluamos al decidir esta estrategia.
function sedeAdminEfectiva() {
  return 'principal';
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

// ── Fidelización: saldo de un cliente y a cuánto dinero equivale — sin estados de "cerca" o
// "premio disponible" (esos existian porque el sistema anterior tenia premios con umbrales
// discretos; con puntos = dinero directo, no hace falta escalonar nada, cualquier saldo ya es
// canjeable a la tasa fija).
function estadoFidelizacion(clienteId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (!cli) return { saldo: 0, valorCanjeable: 0 };
  const saldo = cli.puntos || 0;
  const tasaCanje = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaCanje) || 300;
  return { saldo, valorCanjeable: Math.floor((saldo / tasaCanje) * 100) / 100 };
}

// ── Procesa un canje de puntos por dinero — reemplaza el sistema anterior de premios
// configurables (producto/descuento con catalogo propio). Ahora es directo: X puntos = X/300
// soles de descuento, sin catalogo que mantener ni merma de producto que registrar (ya no hay
// premios de tipo producto). El monto resultante se refleja en el descuento de la venta actual.
async function procesarCanje(clienteId, puntosACanjear) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  puntosACanjear = Math.floor(puntosACanjear || 0);
  if (!cli || puntosACanjear <= 0) { alert('No se pudo procesar el canje.'); return null; }
  if ((cli.puntos || 0) < puntosACanjear) { alert('El cliente ya no tiene suficientes puntos.'); return null; }

  // Mitigación de doble-canje entre 2 dispositivos: verifica el saldo REAL en el servidor
  // justo antes de confirmar — reduce la ventana de riesgo al tiempo de esta consulta, no a
  // toda la sesión. No es una transacción (rompería el trabajo offline ya hecho) — si no hay
  // conexión, sigue con el chequeo local, igual que antes de este fix.
  if (dbModular) { // [SDK modular]
    try {
      const doc = await getDocM(docM(dbModular, 'clientes', String(clienteId)));
      if (doc.exists()) { // en modular, exists es un METODO, no una propiedad
        const saldoReal = doc.data().puntos || 0;
        if (saldoReal < puntosACanjear) {
          alert(`⚠️ El saldo de este cliente cambió (probablemente ya se procesó un canje desde otro dispositivo). Saldo actual: ${saldoReal} puntos — no se completó este canje.`);
          return null;
        }
      }
    } catch(e) {
      console.warn('procesarCanje: no se pudo verificar el saldo en el servidor, continuando con el valor local', e);
    }
  }

  const tasaCanje = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaCanje) || 300;
  const montoDescuento = Math.floor((puntosACanjear / tasaCanje) * 100) / 100;
  const sede = sedeAdminEfectiva();
  const canje = {
    id: getId(), clienteId, fecha: today(), hora: nowTime(),
    puntosUsados: puntosACanjear, montoDescuento, staff: currentUser, sedeId: sede
  };

  // Paquete atomico: puntos descontados y canje registrado viajan juntos — sin esto podian
  // perderse puntos de un cliente sin que quedara registro del canje (o al reves).
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return null; } // [SDK modular]
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'canjes', String(canje.id)), canje);
  batch.set(docM(dbModular, 'clientes', String(clienteId)), {
    puntos: incrementM(-puntosACanjear)
  }, { merge: true });

  _sincIniciar('canje_lote', canje.id);
  try {
    await batch.commit();
    _sincTerminar('canje_lote', canje.id);
  } catch (e) {
    _sincError('canje_lote', canje.id, e, 'el canje de fidelización — no se aplicó nada, los puntos siguen intactos');
    return null;
  }

  const descInput = document.getElementById('pos-descuento'); // campo unico, compartido entre desktop y movil
  if (descInput) descInput.value = (parseFloat(descInput.value) || 0) + montoDescuento;
  // El lote ya escribió esto en Firestore — el interruptor evita que el Proxy del cliente
  // dispare su propia escritura encima (mismo riesgo que ya se corrigió en caja).
  _clienteProxySkipSync = true;
  try { cli.puntos = (cli.puntos || 0) - puntosACanjear; } finally { _clienteProxySkipSync = false; }
  fbGuardar();
  return canje;
}

// ── Asignación manual de puntos — solo admin. Pensada para migrar el historial de un cliente
// que venía de antes de este sistema, o para un ajuste puntual — no es un bono automático de
// bienvenida, es una acreditación deliberada, caso por caso. Queda registrada como movimiento
// para poder rastrear quién la aplicó y por qué, sin necesidad de una colección nueva.
async function asignarPuntosManual(clienteId) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede asignar puntos manualmente.'); return; }
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (!cli) return;
  const cantidad = parseInt(prompt(`Asignar puntos a ${cli.nombre} (saldo actual: ${cli.puntos||0}).\n\nCantidad a acreditar (puede ser negativa para corregir):`));
  if (!cantidad || isNaN(cantidad)) return;
  const motivo = prompt('Motivo (ej. "Migración sistema anterior"):') || 'Ajuste manual';
  if (!confirm(`¿Confirmar ${cantidad > 0 ? 'acreditar' : 'descontar'} ${Math.abs(cantidad)} puntos a ${cli.nombre}?\n\nMotivo: ${motivo}`)) return;

  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const sede = sedeAdminEfectiva();
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'clientes', String(clienteId)), { puntos: incrementM(cantidad) }, { merge: true });
  const _movId = getId();
  const _movData = { id: _movId, tipo: 'ajuste_puntos', desc: `Ajuste manual de puntos: ${cantidad > 0 ? '+' : ''}${cantidad} — ${cli.nombre} — ${motivo}`, monto: 0, hora: nowTime(), fecha: today(), usuario: currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  _sincIniciar('ajuste_puntos_lote', clienteId);
  try {
    await batch.commit();
    _sincTerminar('ajuste_puntos_lote', clienteId);
  } catch (e) {
    _sincError('ajuste_puntos_lote', clienteId, e, 'el ajuste de puntos — no se aplicó nada');
    return;
  }
  _clienteProxySkipSync = true;
  try { cli.puntos = (cli.puntos || 0) + cantidad; } finally { _clienteProxySkipSync = false; }
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  alert(`✅ Puntos actualizados. Nuevo saldo: ${cli.puntos} puntos.`);
  try { renderFrecuentes(); } catch(e){}
  try { renderClientes(); } catch(e){}
}

// Extended DB with new modules
const DB_EXT = {
  sueldos: {'Jose Carlos':0,'Shessira':0,'José Luis':0},
  // ── Fidelización (puntos canjeables por dinero, sin catálogo de premios) ──
  // tasaBase: puntos por sol gastado (se multiplica ademas por el multiplicador de cada
  // categoria, configurable en Frecuentes). tasaCanje: cuantos puntos equivalen a S/1 al
  // canjear — fijo en 300 (300 puntos = S/1), sin importar de que categoria vinieron los
  // puntos ganados. Elimina a proposito el sistema anterior de "niveles" (por gasto anual) y
  // el catalogo de "premios" configurables — es directo: puntos acumulados = dinero canjeable.
  fidelizacion: { tasaBase: 1, tasaCanje: 300 },
 // total/recuperado/prestamoPagado ya NO viven acá — se calculan en vivo desde
 // DB.capitalMovimientos (ver los getters mas abajo), para que nunca puedan desincronizarse
 // del historial real. Acá solo quedan los valores de configuracion (cambian poco, bajo
 // riesgo de choque entre dispositivos).
 capital: { prestamo:0, cuota:0, meta:0 },
  gastos: [],
  gastosRec: [
    {id:1, desc:'Energía eléctrica mensual', tipo:'Energía', monto:80},
    {id:2, desc:'Transporte de mercadería', tipo:'Transporte', monto:50}
  ],
  // CRITICO: faltaba por completo — guardarInventarioMensual() en inventario.js hace
  // DB_EXT.inventariosMensuales.push(...), y sin este campo definido aca, esa linea siempre
  // fallaba con "Cannot read properties of undefined (reading 'push')" — el boton "Guardar
  // inventario" nunca guardaba nada, desde que existe esa funcion.
  inventariosMensuales: []
};

// ── Capital: total/recuperado/prestamoPagado se calculan SIEMPRE desde el historial real
// (DB.capitalMovimientos), nunca se guardan como numeros aparte que puedan desincronizarse —
// mismo principio ya aplicado en esta sesion (subtotalFinal): preferir calcular desde la
// fuente de verdad antes que mantener un acumulado que puede quedar mal.
Object.defineProperty(DB_EXT.capital, 'total', {
  get() { return (DB.capitalMovimientos||[]).filter(m=>m.tipo==='aporte').reduce((s,m)=>s+m.monto,0); }
});
Object.defineProperty(DB_EXT.capital, 'recuperado', {
  get() { return (DB.capitalMovimientos||[]).filter(m=>m.tipo==='ganancia').reduce((s,m)=>s+m.monto,0); }
});
Object.defineProperty(DB_EXT.capital, 'prestamoPagado', {
  get() { return (DB.capitalMovimientos||[]).filter(m=>m.tipo==='pago_prestamo').reduce((s,m)=>s+m.monto,0); }
});

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
  capitalMovimientos: [],
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
  if (page === 'historial-ventas') {
    // Al entrar de nuevo a la pagina (no en cada cambio de filtro interno), el selector de
    // sede arranca en la sede activa del admin, no en "Todas las sedes" — evita mezclar datos
    // de ambas sedes por defecto sin que nadie lo haya pedido explicitamente.
    const _selSede = document.getElementById('hv-sede');
    if (_selSede && currentRole === 'admin') _selSede.value = sedeAdminEfectiva();
    renderHistorialVentas();
  }
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

// ── Fiados: monto pendiente real y si "todavía debe algo" — CRITICO, corrige un bug real de
// punto flotante confirmado (JavaScript: 0.1 + 0.2 no da exactamente 0.3). Varios lugares del
// sistema comparaban (f.total - f.pagado) contra 0 sin ninguna tolerancia — un fiado
// completamente pagado podía quedar con un residuo invisible como 0.0000000000018, que se ve
// y redondea como "S/ 0.00" en cualquier pantalla, pero técnicamente sigue siendo > 0. Eso
// hacía que el filtro "Con pendiente" siguiera mostrando clientes ya pagados en su totalidad.
// Esta es la ÚNICA función que debe usarse para decidir si un fiado sigue pendiente — nunca
// comparar (f.total - f.pagado) directo contra 0 en ningún otro lugar del código.
function fiadoMontoPendiente(f) {
  return Math.max(0, Math.round(((f.total||0) - (f.pagado||0)) * 100) / 100);
}
function fiadoPendiente(f) {
  return fiadoMontoPendiente(f) > 0;
}

// ── Deuda del cliente: mismo motivo y patron que fiadoPendiente/fiadoMontoPendiente de arriba
// — cli.deuda se acumula con incrementM() a traves de muchas transacciones separadas en el
// tiempo (pagos parciales, pagos globales, nuevos fiados), el mismo tipo de operacion donde el
// residuo de punto flotante se acumula. Un cliente que salda toda su deuda podia quedar con
// cli.deuda en algo como 0.0000000000018 — se ve y redondea como "S/ 0.00" en cualquier
// pantalla, pero la comparacion directa contra 0 seguia dando true, mostrando el numero en vez
// de "Al dia". Estas son las UNICAS funciones que deben usarse para decidir si un cliente
// sigue debiendo algo — nunca comparar cli.deuda directo contra 0 en ningun otro lugar.
function clienteDeudaMonto(cli) {
  return Math.max(0, Math.round((cli.deuda||0) * 100) / 100);
}
function clienteTieneDeuda(cli) {
  return clienteDeudaMonto(cli) > 0;
}

// ── Costo real de una venta/fiado/pago — CRITICO, corrige 2 problemas reales confirmados:
// 1) Ventas normales (procesarVenta) nunca guardaban costoUnitario en sus items — solo
//    fiados lo hacían. Sin eso, cualquier reporte que recalculara el costo tenía que volver a
//    buscar el producto ACTUAL en el catálogo — si ese producto se eliminó despues de la
//    venta, el costo salía en S/0.00, aunque la venta sí tuvo un costo real ese día.
// 2) Un pago de fiado (origen 'pago_fiado') no tiene array de items — es un registro de pago,
//    no de venta — pero sí trae su costoAsociado ya calculado al momento del pago. Varios
//    reportes ignoraban este campo por completo, mostrando costo cero para pagos reales.
// Esta funcion resuelve ambos: prioriza el costo historico guardado en el item (o el
// costoAsociado del pago), y solo si no existe (ventas viejas, antes de este arreglo) cae al
// costo actual del producto como aproximacion.
function costoVenta(v) {
  if (v.origen === 'pago_fiado' && v.costoAsociado != null) return v.costoAsociado;
  return (v.items||[]).reduce((s,i) => {
    if (i.costoUnitario != null) return s + i.costoUnitario * i.cant;
    const p = DB.productos.find(x => x.id === i.prodId);
    return s + (p ? p.costo * i.cant : 0);
  }, 0);
}

// Mismo criterio que costoVenta() — prioriza el costo historico guardado en la propia merma
// al momento de registrarla, y solo cae al costo actual del producto si es una merma anterior
// a este arreglo (y aun asi, solo si el producto sigue existiendo en el catalogo).
function costoMerma(m) {
  if (m.costoUnitario != null) return m.costoUnitario * (m.cant||0);
  const p = DB.productos.find(x => x.id === m.prodId);
  return p ? p.costo * (m.cant||0) : 0;
}

// Redondea el subtotal de un item del carrito a los 10 centavos más cercanos — solo aplica a
// productos por peso (granel), donde el precio exacto por gramo casi nunca cae en una moneda
// pagable en efectivo (ej. S/1.97). Productos por unidad no se tocan, su precio ya es exacto.
// Si el item YA tiene subtotalFinal grabado (viene de una venta/fiado ya persistida — ver
// aplicarPreciosProporcionales), se usa ese valor directo, sin recalcular — así Reportes,
// Historial y cualquier pantalla que muestre una venta pasada coincide exacto con lo que
// realmente se cobró, en vez de recalcular precio*cant y arriesgarse a un numero distinto.
function subtotalItemCarrito(item) {
  if (item.subtotalFinal != null) return item.subtotalFinal;
  const bruto = (item.precio || 0) * (item.cant || 0);
  if (item.tipo !== 'granel') return bruto;
  return Math.round(bruto * 10) / 10;
}
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
  const pendiente = fiadoMontoPendiente(f);
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
  const _t0b = performance.now();
  console.log(`⏱️ [T+0ms] DOMContentLoaded disparado, arrancando await iniciarFirebase()`);
  const fbOk = await iniciarFirebase();
  console.log(`⏱️ [T+${(performance.now()-_t0b).toFixed(0)}ms] await iniciarFirebase() TERMINO, fbOk=${fbOk}`);
  // CRITICO: el boton empieza deshabilitado (ver index.html) — sin esto, un click antes de
  // que iniciarFirebase() termine su rama modular disparaba "docM is not a function" dentro
  // del login (docM/dbModular todavia no existian), silenciosamente saltandose toda la
  // reconciliacion de datos frescos y cayendo a cache local vieja. Se habilita aca, recien
  // cuando iniciarFirebase() realmente termino — tanto si tuvo exito como si fallo, para no
  // dejar al usuario con un boton eternamente en "Cargando..." sin explicacion.
  const _btnLogin = document.getElementById('btn-login');
  if (_btnLogin) {
    _btnLogin.disabled = false;
    _btnLogin.textContent = fbOk ? 'Ingresar' : '⚠️ Ingresar (sin conexión)';
  }

  if (fbOk) {
    try {
      // Carga inicial pre-login: solo el catálogo público (db_productos).
      // 'db' y 'db_ext' ahora requieren sesión — se cargan en PASO 3 del login.
      console.log(`⏱️ [T+${(performance.now()-_t0b).toFixed(0)}ms] arrancando getDocM(db_productos)`);
      const snapProd = await getDocM(docM(dbModular, 'aleze', 'db_productos')); // [SDK modular]
      console.log(`⏱️ [T+${(performance.now()-_t0b).toFixed(0)}ms] getDocM(db_productos) TERMINO`);

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
      console.warn('Firestore no disponible:', e.message);
      _mostrarErrorConexionInicial();
    }
  } else {
    _mostrarErrorConexionInicial();
  }
});

// CRITICO: reemplaza a _initLocal()/_semillaDemo() — esas funciones, pensadas originalmente
// para desarrollo sin Firebase configurado, seguian vivas en produccion y se disparaban cada
// vez que la carga inicial fallaba por cualquier motivo (incluida la misma condicion de
// carrera de docM que ya se corrigio en otro punto, pero que podia repetirse aca). El
// resultado: la app se rellenaba en silencio con ventas y clientes 100% inventados —
// usando incluso los nombres reales del personal como "cajeros" de esas ventas falsas — sin
// ningun aviso de que no eran datos reales. Ahora, en vez de inventar datos del negocio,
// se avisa claro y se ofrece reintentar. Funciona sin importar que vista este activa debajo
// (admin o tienda publica), ya que se dibuja encima de todo con position:fixed.
function _mostrarErrorConexionInicial() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(17,24,39,.92);display:flex;align-items:center;justify-content:center;padding:1.5rem;font-family:system-ui,sans-serif';
  el.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:1.75rem 1.5rem;max-width:340px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)">
      <div style="font-size:2.5rem;margin-bottom:.5rem">📡</div>
      <div style="font-weight:800;font-size:1.05rem;color:#1f2937;margin-bottom:.5rem">No se pudo conectar</div>
      <div style="font-size:.85rem;color:#6b7280;margin-bottom:1.25rem;line-height:1.4">No se pudo cargar la información de la tienda. Revisa tu conexión a internet e intenta de nuevo.</div>
      <button onclick="location.reload()" style="width:100%;padding:.7rem;background:#7C3AED;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:.9rem;cursor:pointer">🔄 Reintentar</button>
    </div>`;
  document.body.appendChild(el);
}


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


