// ===================== POS =====================
function renderPos() {
  renderPosCategorias();
  renderPosGrid();
  renderCart();
  updatePosClientes();
}

function renderPosCategorias() {
  const wrap = document.getElementById('pos-categorias');
  wrap.innerHTML = `<span class="tag ${posFilterCat === '' ? 'active' : ''}" onclick="setPosFilter('')">🏪 Todos</span>`;
  const catPromo = DB.categorias.find(c => c.nombre === 'Promociones');
  const otrosCats = DB.categorias.filter(c => c.nombre !== 'Promociones');
  const catsOrdenadas = catPromo ? [catPromo, ...otrosCats] : otrosCats;
  catsOrdenadas.forEach(c => {
    const icon = c.imagen
      ? `<img src="${c.imagen}" style="width:16px;height:16px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:3px"/>`
      : (c.emoji + ' ');
    wrap.innerHTML += `<span class="tag ${posFilterCat == c.id ? 'active' : ''}" onclick="setPosFilter(${c.id})">${icon}${c.nombre}</span>`;
  });
}

function setPosFilter(id) { posFilterCat = id; renderPosCategorias(); renderPosGrid(); }

function renderPosGrid(search = '') {
  // Guard: no renderizar sin sesión activa
  if (!currentUser) return;
  const s = search || document.getElementById('pos-search')?.value.toLowerCase() || '';
  let prods = DB.productos.filter(p => (stockEnSede(p) > 0) && (!p.esCombo || p.promoActiva !== false));
 if (s) prods = prods.filter(p => _norm(p.nombre).includes(_norm(s)) || _norm(p.codigo||'').includes(_norm(s)));
  if (posFilterCat) prods = prods.filter(p => p.cat == posFilterCat);
  const promoActivas = DB.promociones.filter(p => p.activa && p.hasta >= today() && _promoAplicaSede(p, currentUserSedeId || 'principal'));
  document.getElementById('pos-grid').innerHTML = prods.map(p => {
    const promoDelProducto = p.esCombo
      ? promoActivas.find(pr => pr.packProdId === p.id)
      : promoActivas.find(pr => !pr.packProdId && pr.prod1 == p.id && !pr.prod2);
    const esPromoCantidad = promoDelProducto && (promoDelProducto.tipo === '2x1' || promoDelProducto.tipo === '3x2');
    const precioMostrar = (p.esCombo || esPromoCantidad) ? p.precio : (promoDelProducto ? promoDelProducto.precioPromo : p.precio);
    const precioOrigMostrar = (!esPromoCantidad && promoDelProducto && promoDelProducto.precioOrig > precioMostrar) ? promoDelProducto.precioOrig : null;
    const pctDesc = precioOrigMostrar ? Math.round((1 - precioMostrar / precioOrigMostrar) * 100) : 0;
    const promoTag = promoDelProducto
      ? `<span class="promo-tag">${esPromoCantidad ? promoDelProducto.tipo : (pctDesc > 0 ? `-${pctDesc}%` : (p.esCombo ? 'OFERTA' : 'PROMO'))}</span>`
      : '';
    const iconHtml = p.imagen
      ? `<div class="p-img-wrap"><img src="${p.imagen}" alt="${p.nombre}"></div>`
      : `<div class="p-img-wrap"><div class="p-icon">${getCatIcono(p.cat)}</div></div>`;
    return `<div class="product-card ${promoDelProducto?'en-oferta':''}" onclick="addToCart(${p.id})">
      ${iconHtml}
      <div class="p-info">
        <div class="p-name">${p.nombre}</div>
        <div class="p-price">${precioOrigMostrar ? `<span class="p-price-orig">${sol(precioOrigMostrar)}</span> ` : ''}${sol(precioMostrar)} ${promoTag}</div>
        <div class="p-stock">Stock: ${stockEnSede(p)} ${p.unidad}</div>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--gray-400);font-size:0.85rem;padding:1rem">Sin productos</p>';
}

function filterPosProducts() { renderPosGrid(); }
// Variables de control de ráfaga física (Aisladas de Firebase y la lógica de negocio)
let _lastScannerKeyTime = Date.now();
let _isHardwareScanner = false;

function _posEnterScan() {
  const s = document.getElementById('pos-search')?.value || '';
  if (!s) return;
  
  const matches = DB.productos.filter(p =>
    (stockEnSede(p) > 0) &&
    (!p.esCombo || p.promoActiva !== false) &&
    (_norm(p.codigo||'') === _norm(s) || _norm(p.nombre).includes(_norm(s)) || _norm(p.codigo||'').includes(_norm(s)))
  );
  
  if (matches.length === 1) {
    addToCart(matches[0].id);
    document.getElementById('pos-search').value = '';
    filterPosProducts();
    _isHardwareScanner = false; 
  } else {
    // Si la entrada provino de la lectora (velocidad física) o es un código numérico largo erróneo
    if (_isHardwareScanner || (s.length >= 8 && !isNaN(s))) {
      document.getElementById('pos-search').value = '';
      filterPosProducts();
    }
    _isHardwareScanner = false; 
  }
}

function _mobPosEnterScan() {
  const s = document.getElementById('mob-pos-search')?.value || '';
  if (!s) return;
  
  const matches = DB.productos.filter(p =>
    (stockEnSede(p) > 0) &&
    (!p.esCombo || p.promoActiva !== false) &&
    (_norm(p.codigo||'') === _norm(s) || _norm(p.nombre).includes(_norm(s)) || _norm(p.codigo||'').includes(_norm(s)))
  );
  
  if (matches.length === 1) {
    mobAddToCart(matches[0].id);
    document.getElementById('mob-pos-search').value = '';
    mobFilterPos();
    _isHardwareScanner = false; 
  } else {
    if (_isHardwareScanner || (s.length >= 8 && !isNaN(s))) {
      document.getElementById('mob-pos-search').value = '';
      mobFilterPos();
    }
    _isHardwareScanner = false; 
  }
}

function addToCart(prodId) {
  const prod = DB.productos.find(p => p.id === prodId);
  if (!prod) return;
  const promoActivas = DB.promociones.filter(p => p.activa && p.hasta >= today() && _promoAplicaSede(p, currentUserSedeId || 'principal'));
  const promo = promoActivas.find(pr => !pr.packProdId && pr.prod1 == prodId && !pr.prod2);
  const esPromoCantidad = promo && (promo.tipo === '2x1' || promo.tipo === '3x2');
  const precio = (promo && !esPromoCantidad) ? promo.precioPromo : prod.precio;
  const existing = cart.find(i => i.prodId === prodId);
  // Pack: limite por venta es un bloqueo directo, no un precio distinto para el exceso — no
  // hay un "precio normal" claro al que revertir un pack extra (confirmado explicitamente).
  if (prod.esCombo) {
    const promoPack = promoActivas.find(pr => pr.packProdId === prodId);
    if (promoPack && promoPack.maxPorVenta > 0 && (existing ? existing.cant : 0) >= promoPack.maxPorVenta) {
      alert(`Máximo ${promoPack.maxPorVenta} unidad(es) de este pack por venta.`);
      return;
    }
  }
  // Descuento directo y 2x1/3x2: no se bloquea (el cliente puede seguir comprando), pero se
  // avisa de forma clara e inmediata en el momento exacto en que la unidad agregada ya no
  // lleva el descuento — nunca dejar que el cliente crea que sigue llevando promo cuando ya
  // no es asi. Se muestra solo una vez, justo al cruzar el umbral, no en cada click siguiente.
  if (promo && promo.maxPorVenta > 0 && existing && existing.cant === promo.maxPorVenta) {
    alert(`⚠️ Ya se alcanzó el máximo de ${promo.maxPorVenta} unidad(es) con precio promocional de "${prod.nombre}". Las siguientes se cobran al precio normal (${sol(prod.precio)}).`);
  }
  if (existing) {
    if (existing.cant >= stockEnSede(prod)) { alert('Stock insuficiente'); return; }
    existing.cant++;
  } else {
    // CRITICO - bug real confirmado: el valor inicial para granel era 0.5, pero el click
    // siguiente (existing.cant++, mas abajo) SIEMPRE suma exactamente 1, sin importar el tipo
    // de producto. La combinacion daba 0.5 + 1 = 1.5 en el segundo click, no 1.0 como se
    // esperaria. Arreglado para que el primer click TAMBIEN sume 1, consistente con los
    // siguientes — el peso exacto se ajusta despues con el campo de gramos, no a los clicks.
    cart.push({ prodId, nombre: prod.nombre, precio, cant: 1, tipo: prod.tipo, unidad: prod.unidad });
  }
  renderCart(); calcTotal();
}

function renderCart() {
  const wrap = document.getElementById('cart-items');
  if (cart.length === 0) {
    wrap.innerHTML = '<p style="text-align:center;color:var(--gray-400);font-size:0.85rem;padding:2rem 0">Carrito vacío — agrega productos</p>';
    return;
  }
  wrap.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      <div class="cart-item-name">${item.nombre}</div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
       ${item.tipo==='granel'
          ? `<input type="number" class="qty-val" min="1" step="1" value="${Math.round(item.cant*1000)}"
               onchange="setGranelQty(${i},this.value)"
               style="width:62px;text-align:center;border:1px solid var(--gray-200);border-radius:4px;font-size:.85rem;padding:1px 3px"> g`
          : `<span class="qty-val">${item.cant}</span>`}
        <button class="qty-btn" onclick="changeQty(${i},1)">+</button>
      </div>
      <div class="cart-item-price">${sol(subtotalItemCarrito(item))}</div>
      <button class="qty-btn" onclick="removeItem(${i})" style="background:var(--danger-light);color:var(--danger)">✕</button>
    </div>`).join('');
  if (isMobile()) mobUpdateBar();
}

function changeQty(i, delta) {
  const prod = DB.productos.find(p => p.id === cart[i].prodId);
  const step = cart[i].tipo === 'granel' ? 0.25 : 1;
  cart[i].cant = Math.max(step, Math.min(prod ? stockEnSede(prod) : 999, cart[i].cant + delta * step));
  renderCart(); calcTotal();
}

function setGranelQty(i, val) {
  if (i >= cart.length) return;
  // El input muestra y recibe GRAMOS directos (ej. "337"), no kg decimal — se convierte acá,
  // una sola vez, para no obligar al cajero a hacer la division mental.
  const gramos = parseFloat(val) || 10;
  const prod = DB.productos.find(p => p.id === cart[i].prodId);
  const max = prod ? stockEnSede(prod) : 999;
  const cant = gramos / 1000;
  cart[i].cant = Math.max(0.01, Math.min(max, parseFloat(cant.toFixed(3))));
  // Actualizar precio del ítem sin re-renderizar el carrito completo
  const cartItems = document.querySelectorAll('.cart-item');
  if (cartItems[i]) {
    const priceEl = cartItems[i].querySelector('.cart-item-price');
    if (priceEl) priceEl.textContent = sol(cart[i].precio * cart[i].cant);
  }
  calcTotal();
}

function removeItem(i) { cart.splice(i, 1); renderCart(); calcTotal(); }
function clearCart() { cart = []; renderCart(); calcTotal(); document.getElementById('pos-search').value = ''; const dc = document.getElementById('pos-descuento'); if (dc) dc.value = ''; const mp = document.getElementById('pos-metodo-pago'); if (mp) mp.value = 'Efectivo'; renderPosGrid(); try { updatePosCartBadge(); } catch(e){} try { mobUpdateBar(); } catch(e){} }


// ── Helper: get category icon (image if available, else emoji) ──
function getCatIcono(catId, size) {
  const c = DB.categorias.find(x => x.id == catId);
  if (!c) return '📦';
  if (c.imagen) return c.imagen.startsWith('data:') || c.imagen.startsWith('http')
    // Sin "size" explicito, llena el contenedor (pensado para .p-img-wrap, formato cuadrado) —
    // con "size" explicito, mantiene el comportamiento anterior para otros usos futuros chicos.
    ? (size
        ? '<img src="'+c.imagen+'" style="width:'+size+'px;height:'+size+'px;object-fit:cover;border-radius:4px;vertical-align:middle"/>'
        : '<img src="'+c.imagen+'" style="width:100%;height:100%;object-fit:contain"/>')
    : (c.emoji || '📦');
  return c.emoji || '📦';
}

// ── Helper: distribute combo discount proportionally across items ──
// Genera los items finales de una venta o fiado — con precio ajustado por combo si aplica, y
// CRITICO: con el subtotal YA REDONDEADO grabado explícito en cada item (subtotalFinal). Sin
// esto, Reportes/Historial/WhatsApp recalcularían precio*cant desde cero y mostrarían un
// número distinto al que realmente se cobró en la venta — el redondeo de productos por peso
// se perdería en cualquier pantalla que no sea el carrito original. Se usa tanto en
// procesarVenta() como en cobrarFiado(), ambas pasan por esta misma función.
function aplicarPreciosProporcionales(cartRef, comboInfo, cantidadInfo, recargoInfo) {
  const result = cartRef.map(i => ({ ...i }));
  if (comboInfo && comboInfo.total > 0) {
    const promoActivas = DB.promociones.filter(p => p.activa && p.hasta >= today() && p.prod2 && _promoAplicaSede(p, currentUserSedeId || 'principal'));
    promoActivas.forEach(promo => {
      const idx1 = result.findIndex(i => i.prodId == promo.prod1);
      const idx2 = result.findIndex(i => i.prodId == promo.prod2);
      if (idx1 < 0 || idx2 < 0) return;
      const sets = Math.min(result[idx1].cant, result[idx2].cant);
      if (sets <= 0) return;
      const p1 = DB.productos.find(p => p.id == promo.prod1);
      const p2 = DB.productos.find(p => p.id == promo.prod2);
      const r1 = p1 ? p1.precio : result[idx1].precio;
      const r2 = p2 ? p2.precio : result[idx2].precio;
      const sumR = r1 + r2;
      if (sumR === 0) return;
      const comboP1 = Math.round((r1/sumR) * promo.precioPromo * 100) / 100;
      const comboP2 = Math.round((promo.precioPromo - comboP1) * 100) / 100;
      const blend = (base, comboP, cant) => Math.round((comboP * sets + base * (cant - sets)) / cant * 100) / 100;
      result[idx1] = { ...result[idx1], precio: blend(r1, comboP1, result[idx1].cant), precioOriginal: r1, enCombo: true };
      result[idx2] = { ...result[idx2], precio: blend(r2, comboP2, result[idx2].cant), precioOriginal: r2, enCombo: true };
    });
  }
  if (cantidadInfo && cantidadInfo.total > 0) {
    // 2x1/3x2: por cada grupo completo de "cantidadRequerida" unidades del MISMO producto,
    // "cantidadRequerida - cantidadAPagar" son gratis. El precio final por item es un
    // promedio ponderado (blend) entre unidades pagadas y gratis, para que precio*cant de
    // exactamente el total correcto — mismo criterio ya usado arriba para el combo de 2 productos.
    const promoCantidad = DB.promociones.filter(p =>
      p.activa && p.hasta >= today() && (p.tipo === '2x1' || p.tipo === '3x2') &&
      p.cantidadRequerida > 1 && _promoAplicaSede(p, currentUserSedeId || 'principal'));
    promoCantidad.forEach(promo => {
      const idx = result.findIndex(i => i.prodId == promo.prod1);
      if (idx < 0) return;
      const cant = result[idx].cant;
      // Maximo por venta: las unidades mas alla de este tope quedan fuera del calculo de
      // grupos — mismo criterio ya aplicado en calcDescuentoCantidad() para la vista en vivo,
      // aca se repite porque este es un calculo independiente para el precio final por item.
      const cantParaPromo = promo.maxPorVenta > 0 ? Math.min(cant, promo.maxPorVenta) : cant;
      const grupos = Math.floor(cantParaPromo / promo.cantidadRequerida);
      if (grupos <= 0) return;
      const prod = DB.productos.find(p => p.id == promo.prod1);
      const precioNormal = prod ? prod.precio : result[idx].precio;
      const unidadesPagadas = cant - grupos * (promo.cantidadRequerida - promo.cantidadAPagar);
      const precioBlend = Math.round((unidadesPagadas * precioNormal) / cant * 100) / 100;
      result[idx] = { ...result[idx], precio: precioBlend, precioOriginal: precioNormal, enPromoCantidad: true };
    });
  }
  if (recargoInfo && recargoInfo.total > 0) {
    // Descuento directo: el item ya entro al carrito con el precio promo aplicado a TODAS
    // sus unidades (ver addToCart) — por cada unidad que excede el maximo por venta, el
    // precio final por item es un promedio ponderado entre las unidades a precio promo y las
    // que exceden el limite (a precio normal), mismo criterio de blend que los bloques de arriba.
    const promoDescLimitada = DB.promociones.filter(p =>
      p.activa && p.hasta >= today() && p.tipo === 'descuento' && p.maxPorVenta > 0 &&
      _promoAplicaSede(p, currentUserSedeId || 'principal'));
    promoDescLimitada.forEach(promo => {
      const idx = result.findIndex(i => i.prodId == promo.prod1);
      if (idx < 0) return;
      const cant = result[idx].cant;
      const unidadesExceso = Math.max(0, cant - promo.maxPorVenta);
      if (unidadesExceso <= 0) return;
      const prod = DB.productos.find(p => p.id == promo.prod1);
      const precioNormal = prod ? prod.precio : result[idx].precio;
      const precioPromoActual = result[idx].precio; // ya es el precio promo, asignado en addToCart
      const unidadesConPromo = cant - unidadesExceso;
      const precioBlend = Math.round((unidadesConPromo * precioPromoActual + unidadesExceso * precioNormal) / cant * 100) / 100;
      result[idx] = { ...result[idx], precio: precioBlend, precioOriginal: precioNormal, enRecargoLimite: true };
    });
  }
  result.forEach(i => { i.subtotalFinal = subtotalItemCarrito(i); });
  return result;
}

// ── Auto-open caja when date changes or first action of the day ──
// CRITICO: usa runTransaction() en vez de leer y escribir por separado. Firestore garantiza
// que la lectura dentro de una transaccion es SIEMPRE real, del servidor, nunca de cache
// local — ni siquiera con la persistencia offline activada. Esto cierra de raiz la carrera
// que causaba "saldo heredado S/0.00" despues de un cierre: antes, un simple .get() podia
// devolver una version en cache por una fraccion de segundo, incluso estando online.
// Ademas, si dos dispositivos intentan auto-abrir al mismo instante, Firestore resuelve el
// orden solo (reintenta la transaccion perdedora automaticamente) — nunca se pisan.
//
// Las transacciones NO funcionan sin conexion (limitacion real de Firestore, no una eleccion
// de diseño). Como la apertura debe funcionar con solo abrir la app, sin importar la señal,
// hay un respaldo: si la transaccion falla por estar offline, se abre localmente con la
// mejor informacion disponible en ese momento (igual que el comportamiento historico), sin
// bloquear ninguna venta. El listener dedicado a caja (fbEscucharCaja) corrige esto solo en
// cuanto vuelva la señal — el servidor manda siempre, aunque ya se hayan hecho ventas locales
// con el saldo viejo mientras tanto (decisión confirmada explícitamente).
//
// Proteccion contra llamadas concurrentes DENTRO del mismo dispositivo: checkAutoAbrirCaja()
// (disparado en cada navegación) llama a esta funcion sin esperarla — esta promesa compartida
// hace que cualquier llamada que llegue mientras una apertura ya esta en curso espere esa
// MISMA apertura, en vez de arrancar una segunda por su cuenta.
let _ensureCajaAbiertaPromise = null;
async function ensureCajaAbierta() {
  if (_ensureCajaAbiertaPromise) { await _ensureCajaAbiertaPromise; return; }
  const fechaHoy = today();
  if (DB.caja.abierta && DB.caja.fecha === fechaHoy) return; // already open today

  _ensureCajaAbiertaPromise = (async () => {
    const _sedeECA = sedeAdminEfectiva();
    const cajaRef = dbModular ? docM(dbModular, 'caja', _sedeECA) : null; // [SDK modular]
    let _cajaResultado = null;
    let _offline = false;
    let _movApertura = null;

    if (dbModular) {
      try {
        const _r = await runTransactionM(dbModular, async (tx) => {
          const snap = await tx.get(cajaRef); // lectura garantizada real, nunca de cache
          const cajaServidor = snap.exists() ? snap.data() : null; // en modular, exists es un METODO

          if (cajaServidor && cajaServidor.abierta && cajaServidor.fecha === fechaHoy) {
            return { caja: cajaServidor, mov: null }; // ya esta correctamente abierta, nada que escribir
          }

          const montoAuto = parseFloat(DB.config && DB.config.montoAperturaAuto) || 0;
          let inicialNuevo = montoAuto;
          let inicialEfectivoNuevo = montoAuto;
          if (cajaServidor && cajaServidor.abierta && cajaServidor.fecha && cajaServidor.fecha !== fechaHoy) {
            const saldoAnt = (cajaServidor.inicial||0) + (cajaServidor.ingresos||0) - (cajaServidor.egresos||0);
            const saldoEfectivoAnt = ((cajaServidor.inicialEfectivo ?? cajaServidor.inicial) || 0) + (cajaServidor.ingresosEfectivo||0) - (cajaServidor.egresos||0) - (cajaServidor.retiros||0);
            inicialNuevo = saldoAnt; // ENCADENA: el saldo real de ayer (todos los medios de pago) es el punto de partida de hoy
            inicialEfectivoNuevo = saldoEfectivoAnt;
            const _movCierreId = getId();
            const _movCierre = { id:_movCierreId, tipo:'cierre-auto', desc:'Cierre automático — '+cajaServidor.fecha+' Saldo: '+sol(saldoAnt), monto:saldoAnt, hora:'23:59', fecha:cajaServidor.fecha, sedeId:_sedeECA };
            tx.set(docM(dbModular, 'movimientos', String(_movCierreId)), _movCierre);
          } else if (cajaServidor && typeof cajaServidor.saldoFinal === 'number') {
            inicialNuevo = cajaServidor.saldoFinal; // reapertura tras cierre manual: hereda el saldo real
            inicialEfectivoNuevo = (typeof cajaServidor.saldoFinalEfectivo === 'number') ? cajaServidor.saldoFinalEfectivo : cajaServidor.saldoFinal;
          }

          const cajaNueva = { abierta:true, inicial:inicialNuevo, inicialEfectivo:inicialEfectivoNuevo, ingresos:0, ingresosEfectivo:0, egresos:0, retiros:0, turnoInicio:nowTime(), cajero:currentUser||'Sistema', fecha:fechaHoy, apertura:'auto' };
          tx.set(cajaRef, cajaNueva);
          const _movAperturaId = getId();
          const _mov = { id:_movAperturaId, tipo:'ingreso', desc:'Apertura automática — '+fechaHoy+' (saldo heredado: '+sol(inicialNuevo)+')', monto:0, hora:nowTime(), fecha:fechaHoy, sedeId:_sedeECA };
          tx.set(docM(dbModular, 'movimientos', String(_movAperturaId)), _mov);
          return { caja: cajaNueva, mov: _mov };
        });
        _cajaResultado = _r.caja;
        _movApertura = _r.mov;
      } catch(e) {
        console.warn('ensureCajaAbierta: transacción falló (probablemente sin conexión), usando respaldo local:', e.message);
        _offline = true;
      }
    } else {
      _offline = true;
    }

    if (_offline) {
      // Respaldo offline: abrir localmente con lo mejor disponible, sin bloquear la venta.
      // El servidor manda siempre en cuanto vuelva la señal (decisión ya confirmada) — el
      // listener dedicado a caja corrige esto solo, no hace falta ninguna accion manual.
      const montoAuto = parseFloat(DB.config && DB.config.montoAperturaAuto) || 0;
      let inicialNuevo = montoAuto;
      let inicialEfectivoNuevo = montoAuto;
      if (DB.caja.abierta && DB.caja.fecha && DB.caja.fecha !== fechaHoy) {
        const saldoAnt = (DB.caja.inicial||0) + (DB.caja.ingresos||0) - (DB.caja.egresos||0);
        const saldoEfectivoAnt = ((DB.caja.inicialEfectivo ?? DB.caja.inicial) || 0) + (DB.caja.ingresosEfectivo||0) - (DB.caja.egresos||0) - (DB.caja.retiros||0);
        inicialNuevo = saldoAnt;
        inicialEfectivoNuevo = saldoEfectivoAnt;
      } else if (typeof DB.caja.saldoFinal === 'number') {
        inicialNuevo = DB.caja.saldoFinal;
        inicialEfectivoNuevo = (typeof DB.caja.saldoFinalEfectivo === 'number') ? DB.caja.saldoFinalEfectivo : DB.caja.saldoFinal;
      }
      _cajaResultado = { abierta:true, inicial:inicialNuevo, inicialEfectivo:inicialEfectivoNuevo, ingresos:0, ingresosEfectivo:0, egresos:0, retiros:0, turnoInicio:nowTime(), cajero:currentUser||'Sistema', fecha:fechaHoy, apertura:'auto-offline' };
      _movApertura = { id:getId(), tipo:'ingreso', desc:'Apertura automática — '+fechaHoy+' (saldo heredado: '+sol(inicialNuevo)+') [pendiente de confirmar con el servidor]', monto:0, hora:nowTime(), fecha:fechaHoy, sedeId:_sedeECA };
      // Se encola para cuando vuelva la señal — Firestore la aplica sola al reconectar; si el
      // servidor real es distinto, el listener dedicado a caja lo corrige apenas llegue.
      if (dbModular && cajaRef) setDocM(cajaRef, _cajaResultado, { merge: true }).catch(()=>{}); // [SDK modular]
    }

    // El estado local recién se aplica DESPUES de que la escritura real terminó (o fallo) —
    // nunca antes, para que ningun otro llamador que llegue mientras tanto vea "ya esta
    // abierta" antes de que sea cierto.
    DB._cajas[_sedeECA] = _cajaResultado;
    if (_movApertura) {
      if (!DB.movimientos) DB.movimientos = [];
      DB.movimientos.push(_movApertura);
    }
  })();

  try { await _ensureCajaAbiertaPromise; }
  finally { _ensureCajaAbiertaPromise = null; }
}

async function checkAutoAbrirCaja() {
  const fechaHoy = today();
  const changed = DB.caja.fecha && DB.caja.fecha !== fechaHoy;
  // CRITICO: antes closedWithAuto no revisaba la fecha — bastaba con "esta cerrada y hay
  // monto de apertura automatica configurado" para volver a abrirla. Eso significaba que
  // cualquier cierre manual DURANTE EL DIA se deshacia solo con navegar a otra pantalla,
  // sin importar que se haya cerrado a proposito hace 5 segundos. Ahora solo se auto-abre
  // si quedo cerrada de un DIA ANTERIOR (o nunca se abrio) — un cierre de hoy mismo nunca
  // se revierte por esta via, sin importar cuanto tiempo pase ni cuantas veces se navegue.
  const closedWithAuto = !DB.caja.abierta && DB.caja.fecha !== fechaHoy && parseFloat(DB.config && DB.config.montoAperturaAuto) > 0;
  if (changed || closedWithAuto) {
    // CRITICO: ensureCajaAbierta() ahora hace una lectura real al servidor antes de decidir
    // (agregado para corregir el bug de cache fria por sede) — eso la hizo mas lenta. Antes,
    // renderCaja() se llamaba en la linea siguiente SIN esperarla, pintando la pantalla con
    // el estado de un instante antes — el estado real recien se veia al volver a renderizar
    // (por eso aparecia "hasta actualizar"). Ahora se espera de verdad antes de pintar.
    await ensureCajaAbierta();
    fbGuardar();
    try { renderCaja(); } catch(e){}
    try { renderDashboard(); } catch(e){}
  }
}

// ── Temporizador de medianoche — mientras la app esta abierta ──────────────────────────────
// Complementa (no reemplaza) el disparo por accion de checkAutoAbrirCaja(): si alguien tiene
// la app abierta pasando la medianoche, la transicion de dia se siente automatica, sin
// necesitar que alguien navegue o procese algo primero. Si NADIE tiene la app abierta a esa
// hora (lo mas comun, de madrugada), este temporizador simplemente no esta corriendo — ahi
// sigue siendo la revision retroactiva en la primera accion del dia quien se encarga,
// exactamente como ya funciona. No hay forma de tener un reloj activo sin que alguien tenga
// la pagina abierta — esto es una limitacion real del navegador, no una eleccion de diseño.
let _medianocheTimer = null;
function _programarChequeoMedianoche() {
  if (_medianocheTimer) { clearTimeout(_medianocheTimer); _medianocheTimer = null; }
  const ahora = new Date();
  const proximaMedianoche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 0, 1, 0);
  const msHasta = proximaMedianoche.getTime() - ahora.getTime();
  _medianocheTimer = setTimeout(async () => {
    try {
      await ensureCajaAbierta();
      fbGuardar();
      try { renderCaja(); } catch(e){}
      try { renderDashboard(); } catch(e){}
    } catch(e) { console.warn('[Medianoche] Error en la transicion automatica de dia:', e); }
    _programarChequeoMedianoche(); // reprogramar para la noche siguiente
  }, msHasta);
}

function calcTotal() {
  const sub = cart.reduce((s, i) => s + subtotalItemCarrito(i), 0);
  const desc = parseFloat(document.getElementById('pos-descuento').value) || 0;
  const combo = calcComboDescuento(cart);
  const cantidad = calcDescuentoCantidad(cart);
  const recargo = calcRecargoPorLimitePromo(cart);
  const total = Math.max(0, sub - desc - combo.total - cantidad.total + recargo.total);
  // Render combo discount lines
  const comboEl = document.getElementById('cart-combo-desc');
  if (comboEl) {
    const _lineasHtml =
      combo.lineas.map(l =>
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:var(--accent-light);border-radius:6px;padding:.25rem .5rem;margin-bottom:.2rem">
          <span style="color:var(--accent-dark)">🎁 Combo: ${l.nombre}${l.sets > 1 ? ' ×'+l.sets : ''}</span>
          <span style="font-weight:700;color:var(--accent-dark)">-${sol(l.descuento)}</span>
        </div>`).join('') +
      cantidad.lineas.map(l =>
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:var(--accent-light);border-radius:6px;padding:.25rem .5rem;margin-bottom:.2rem">
          <span style="color:var(--accent-dark)">🏷️ ${l.nombre}${l.grupos > 1 ? ' ×'+l.grupos : ''}</span>
          <span style="font-weight:700;color:var(--accent-dark)">-${sol(l.descuento)}</span>
        </div>`).join('') +
      recargo.lineas.map(l =>
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.78rem;background:#FEF3C7;border-radius:6px;padding:.25rem .5rem;margin-bottom:.2rem">
          <span style="color:#92400E">⚠️ ${l.unidadesExceso} unid. de "${l.nombre}" superan el máx. por venta — a precio normal</span>
          <span style="font-weight:700;color:#92400E">+${sol(l.recargo)}</span>
        </div>`).join('');
    if (combo.total > 0 || cantidad.total > 0 || recargo.total > 0) {
      comboEl.style.display = '';
      comboEl.innerHTML = _lineasHtml;
    } else {
      comboEl.style.display = 'none';
    }
  }
  document.getElementById('cart-total').textContent = sol(total);
  try { updatePosCartBadge(); } catch(e) {} // actualizar badge desktop
}

function updatePosClientes() {
  const sel = document.getElementById('pos-cliente');
  const valorActual = sel.value;
  // Construir el HTML completo antes de asignarlo una sola vez — con += en el bucle, cada
  // asignacion reconstruye y re-parsea todo el HTML acumulado hasta ese punto (O(n²) en vez
  // de O(n)). Se nota con la cantidad de clientes reales del negocio.
  sel.innerHTML = '<option value="">Cliente anónimo</option>' +
    DB.clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nombre) || 'Cliente sin nombre'}</option>`).join('');
  if (valorActual) sel.value = valorActual;
}

// ── Buscador de cliente (POS desktop) — clientes son compartidos entre sedes, un select
// plano se vuelve inmanejable con muchos. El <select> oculto sigue siendo la fuente de verdad
// que el resto del código ya lee (pos-cliente.value) — el buscador solo lo alimenta.
function _posClienteBuscar() {
  const q = (document.getElementById('pos-cliente-buscar')?.value || '').trim();
  const sug = document.getElementById('pos-cliente-sugerencias');
  if (!sug) return;
  const matches = (q ? DB.clientes.filter(c => _norm(c.nombre).includes(_norm(q)) || _norm(c.alias||'').includes(_norm(q)) || (c.tel||'').includes(q)) : DB.clientes).slice(0, 8);
  if (!matches.length) {
    sug.innerHTML = `<div style="padding:.5rem;color:var(--gray-400)">Sin resultados</div>`;
  } else {
    // CRITICO: bug real de insercion automatica de punto y coma de JavaScript. "return" solo
    // en su linea, con el template literal empezando en la linea de abajo, se interpreta como
    // "return;" (nada) — el HTML de abajo quedaba como codigo muerto, nunca se devolvia. El
    // resultado: matches.length SI tenia clientes, entraba a este bloque, pero cada iteracion
    // del .map() devolvia undefined, y .join('') de puros undefined da un string vacio — el
    // dropdown se hacia visible (display:block) pero completamente vacio, indistinguible de
    // "no funciona" para cualquiera que lo mirara. El HTML ahora empieza en la MISMA linea que
    // el return, sin el salto de linea que disparaba la insercion automatica del punto y coma.

   sug.innerHTML = matches.map(c => { const _deudaC = clienteDeudaMonto(c); return `<div onmousedown="event.preventDefault(); _posClienteSeleccionar(${c.id})" style="padding:.4rem .6rem;cursor:pointer;border-bottom:1px solid var(--gray-100)" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
    ${escapeHtml(c.alias || c.nombre)}${_deudaC>0 ? ` <span style="color:var(--danger);font-size:.72rem">(debe ${sol(_deudaC)})</span>` : ''}
   </div>`;
}).join('');
  }
  sug.style.display = 'block';
}
function _posClienteSeleccionar(id) {
  const c = DB.clientes.find(x => x.id === id);
  const sel = document.getElementById('pos-cliente');
  const buscar = document.getElementById('pos-cliente-buscar');
  if (sel) sel.value = id;
  if (buscar) buscar.value = c ? (c.alias || c.nombre) : '';
  const sug = document.getElementById('pos-cliente-sugerencias'); if (sug) sug.style.display = 'none';
  onClienteChange();
}
function resetPosCliente() {
  const sel = document.getElementById('pos-cliente'); if (sel) sel.value = '';
  const buscar = document.getElementById('pos-cliente-buscar'); if (buscar) buscar.value = '';
  onClienteChange();
}

// Buscador/reset de cliente para POS móvil retirado — código muerto (mob-pos-cliente ya no
// existe). El carrito móvil usa el selector compartido (pos-cliente) vía el mismo panel.

let _ventaPendiente = null; // recuerda un intento de venta fallido para reintentar con el mismo id

function _firmaCarrito(items, metodo, clienteId) {
  return JSON.stringify(items.map(i => [i.prodId, i.cant])) + '|' + metodo + '|' + clienteId;
}

// ── Verificacion del limite global de una promocion antes de cobrar ──
// "Limite de unidades (pausa automatica al llegar)" existia como campo desde siempre pero
// nunca se verificaba en ningun lado — esta funcion lo hace real. Lee vendidos FRESCO del
// servidor (nunca cache local, mismo criterio ya usado para el stock real) para cada promo
// con limite que este siendo usada en el carrito. Si el limite ya se alcanzo, pausa la promo
// automaticamente en Firestore y rechaza la venta — el cajero reintenta, y esta vez el
// carrito ya no aplica esa promo (queda excluida por 'activa', igual que cualquier otra).
async function _verificarLimiteGlobalPromos(cartRef) {
  if (!dbModular) return true; // sin conexion no se puede verificar — se deja pasar, mismo criterio que el resto del sistema en ese caso excepcional
  const promosConLimite = DB.promociones.filter(p => {
    if (!(p.activa && p.hasta >= today() && p.limite > 0)) return false;
    if (p.packProdId) return cartRef.some(i => i.prodId === p.packProdId);
    return cartRef.some(i => i.prodId == p.prod1);
  });
  for (const promo of promosConLimite) {
    try {
      const snap = await getDocDelServidorM(docM(dbModular, 'promociones', String(promo.id)));
      const vendidosReal = snap.exists() ? (snap.data().vendidos || 0) : 0;
      if (vendidosReal >= promo.limite) {
        promo.activa = false; // reflejar de inmediato en memoria — el reintento ya no la aplica
        setDocM(docM(dbModular, 'promociones', String(promo.id)), { activa: false }, { merge: true }).catch(()=>{});
        alert(`⚠️ La promoción "${promo.nombre}" alcanzó su límite de unidades y se pausó automáticamente. El carrito ya no incluye ese descuento — revísalo e intenta cobrar de nuevo.`);
        renderCart(); calcTotal();
        return false;
      }
    } catch (e) {
      console.warn('No se pudo verificar el límite de la promo ' + promo.nombre + ', se continúa sin bloquear:', e);
    }
  }
  return true;
}
async function procesarVenta() {
  if (cart.length === 0) { alert('El carrito está vacío'); return; }
  // CRITICO: asegurar caja abierta ANTES de armar el lote — si esto se llama despues del
  // commit, y era la primera operacion del dia, reescribe el documento de caja entero
  // encima del incremento que el lote acaba de escribir. Ver nota en ensureCajaAbierta().
  await ensureCajaAbierta();
  if (!(await _verificarLimiteGlobalPromos(cart))) return;

  const sub = cart.reduce((s, i) => s + subtotalItemCarrito(i), 0);
  const desc = parseFloat(document.getElementById('pos-descuento').value) || 0;
  const comboInfo = calcComboDescuento(cart);
  const cantidadInfo = calcDescuentoCantidad(cart);
  const recargoInfo = calcRecargoPorLimitePromo(cart);
  const comboDesc = comboInfo.total;
  const cantidadDesc = cantidadInfo.total;
  const recargoDesc = recargoInfo.total;
  const total = Math.max(0, sub - desc - comboDesc - cantidadDesc + recargoDesc);
  const metodo = document.getElementById('pos-metodo-pago').value;
  const clienteId = parseInt(document.getElementById('pos-cliente').value) || null;
  const itemsConPrecioReal = aplicarPreciosProporcionales(cart, comboInfo, cantidadInfo, recargoInfo);

  const firma = _firmaCarrito(cart, metodo, clienteId);
  let venta;
  if (_ventaPendiente && _ventaPendiente.firma === firma) {
    venta = _ventaPendiente.venta;
  } else {
    // Comprobante electronico (SUNAT) — dormido hasta activarse en Configuracion, ver
    // _asignarComprobante(). Se pide SOLO aca, al construir la venta por primera vez, nunca
    // en un reintento con el mismo carrito (misma proteccion anti-doble-clic de arriba) —
    // asi un reintento por problemas de red nunca desperdicia un numero correlativo nuevo.
    const _comprobante = await _asignarComprobante('boleta');
    venta = {
      id: getId(), fecha: today(), hora: nowTime(), cajero: currentUser,
      items: itemsConPrecioReal.map(i => {
        const prod = DB.productos.find(p => p.id === i.prodId);
        return { ...i, costoUnitario: prod ? prod.costo : 0 };
      }), subtotal: sub,
      descuento: desc + comboDesc + cantidadDesc, descuentoManual: desc, descuentoCombo: comboDesc, descuentoCantidad: cantidadDesc,
      total, metodo, clienteId, sedeId: sedeAdminEfectiva(),
      comprobante: _comprobante
    };
  }
  _ventaPendiente = { firma, venta };

  if (!DB.historialVentas) DB.historialVentas = [];
  if (DB.historialVentas.some(v => v.id === venta.id)) {
    // Ya se procesó (reintento con el mismo carrito) — no duplicar, solo repetir el ticket.
    _ventaPendiente = null;
    mostrarTicket(venta);
    clearCart();
    resetPosCliente();
    return;
  }

  // Validar TODO antes de tocar nada — si un producto del carrito ya no existe, se corta acá,
  // sin haber descontado stock de ningún otro item ni guardado nada a medias.
  for (const item of cart) {
    const prod = DB.productos.find(p => p.id === item.prodId);
    if (!prod) {
      alert('⚠️ No se pudo procesar la venta: "' + (item.nombre||item.prodId) + '" ya no existe en el catálogo.\n\nNo se guardó nada. Revisa el carrito e intenta de nuevo.');
      _ventaPendiente = null;
      return;
    }
  }

  // ── Paquete atómico: stock, venta, cliente, caja y movimiento viajan juntos en un solo lote
  // — Firestore garantiza que se aplican TODOS o NINGUNO, nunca una parte sin la otra. Antes
  // cada pieza viajaba por separado (independiente), lo que permitía que el stock se
  // descontara sin que la venta llegara a guardarse, o viceversa.
  const sede = sedeAdminEfectiva();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const batch = writeBatchM(dbModular);
  // Agregar deltas por producto ANTES de armar el lote — si el mismo producto aparece dos
  // veces (una suelto, otra como componente de un combo), esto evita escribir el mismo
  // documento de stock dos veces dentro del mismo lote, cosa que Firestore no garantiza que
  // se combine correctamente.
  const _deltasPorProducto = new Map(); // prodId -> {prod, delta}
  const _acumular = (prod, delta) => {
    const actual = _deltasPorProducto.get(prod.id);
    if (actual) actual.delta += delta;
    else _deltasPorProducto.set(prod.id, { prod, delta });
  };
  cart.forEach(item => {
    const prod = DB.productos.find(p => p.id === item.prodId);
    if (!prod.esCombo) _acumular(prod, -item.cant);
    if (prod.esCombo && prod.componentes) {
      prod.componentes.forEach(comp => {
        const cp = DB.productos.find(x => x.id === comp.prodId);
        if (cp) _acumular(cp, -(comp.cant * item.cant));
      });
    }
  });
  const _deltasStock = [];
  // CRITICO: validacion final de stock real ANTES de escribir nada — usando los datos ya
  // sincronizados en tiempo real por el listener activo de POS (suficiente para este
  // contexto; a diferencia de tienda publica, aca no hace falta una lectura extra al
  // servidor porque el carrito no persiste dias, es la misma sesion en vivo). Si algun
  // producto quedaria en negativo (incluidos los componentes de un pack), se corta aca, sin
  // haber escrito nada — nunca a medias.
  for (const { prod, delta } of _deltasPorProducto.values()) {
    if ((prod.stock || 0) + delta < 0) {
      alert('⚠️ No se pudo procesar la venta: no hay stock suficiente de "' + prod.nombre + '" en este momento.\n\nNo se guardó nada. Revisa el carrito e intenta de nuevo.');
      _ventaPendiente = null;
      return;
    }
  }
  _deltasPorProducto.forEach(({prod, delta}) => {
    batch.set(docM(dbModular, 'productos', String(prod.id)),
      { stock: incrementM(delta) }, { merge: true });
    _deltasStock.push({ prod, delta });
  });
  // Limite global: por cada promocion con limite involucrada en esta venta, incrementar
  // vendidos en la misma cantidad que se llevo (simplificacion deliberada: cuenta todas las
  // unidades del item, no solo las que llevaron precio promo — el limite se alcanza un poco
  // antes en vez de un poco despues, mas seguro para el negocio que lo contrario). Viaja en
  // el mismo lote atomico que el resto de la venta — nunca queda descontado sin registrarse.
  const _promosConLimiteEnVenta = DB.promociones.filter(p => {
    if (!(p.activa && p.hasta >= today() && p.limite > 0)) return false;
    if (p.packProdId) return cart.some(i => i.prodId === p.packProdId);
    return cart.some(i => i.prodId == p.prod1);
  });
  _promosConLimiteEnVenta.forEach(promo => {
    const item = cart.find(i => (promo.packProdId ? i.prodId === promo.packProdId : i.prodId == promo.prod1));
    if (!item) return;
    batch.set(docM(dbModular, 'promociones', String(promo.id)), { vendidos: incrementM(item.cant) }, { merge: true });
  });

  const _ventaFinal = { ...venta, sedeId: sede, origen: 'pos', estado: 'completado', estadoStock: 'descontado' };
  batch.set(docM(dbModular, 'ventas', String(venta.id)), _ventaFinal);

  const _movId = getId();
  const _movData = { id: _movId, tipo:'ingreso', desc:`Venta #${venta.id} (${metodo})`, monto:total, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  const _cajaUpdate = { ingresos: incrementM(total) };
  if (metodo === 'Efectivo') _cajaUpdate.ingresosEfectivo = incrementM(total);
  batch.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });

  const _puntosGanados = calcularPuntosGanados(itemsConPrecioReal);
  if (clienteId) {
    batch.set(docM(dbModular, 'clientes', String(clienteId)), {
      compras: incrementM(1),
      total: incrementM(total),
      puntos: incrementM(_puntosGanados)
    }, { merge: true });
  }

  _sincIniciar('venta_lote', venta.id);
  try {
    await batch.commit();
    _sincTerminar('venta_lote', venta.id);
  } catch (e) {
    _sincError('venta_lote', venta.id, e, 'la venta completa (stock, caja, cliente) — no se aplicó nada');
    _ventaPendiente = null;
    return; // No se aplica NADA localmente — el paquete no se completó, se puede reintentar tal cual.
  }

  // El lote ya fue aceptado (confirmado en línea, o encolado si no había señal) — recién ahora
  // se refleja en la memoria local para la interfaz.
  _deltasStock.forEach(({prod, delta}) => {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
  });
  if (clienteId) {
    const cli = DB.clientes.find(c => c.id === clienteId);
    if (cli) {
      _clienteProxySkipSync = true;
      try { cli.compras = (cli.compras||0)+1; cli.total = (cli.total||0)+total; cli.puntos = (cli.puntos||0)+_puntosGanados; }
      finally { _clienteProxySkipSync = false; }
    }
  }
  // CRITICO: antes, un Proxy detectaba esta asignacion y disparaba SU PROPIA escritura al
  // servidor ademas de la que ya hizo el lote atomico — la MISMA venta contada 2 veces en el
  // saldo real. Confirmado como causa directa de los montos duplicados/triplicados
  // observados. Ahora caja es un objeto plano, igual que el stock — esta linea SOLO actualiza
  // la copia local, sin disparar nada por su cuenta.
  DB.caja.ingresos = (DB.caja.ingresos||0) + total;
  if (metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + total;
  
  DB.historialVentas.push(_ventaFinal);
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  fbGuardar();

  _ventaPendiente = null;
  try { renderDashboard(); } catch(e){}
  try { renderCaja(); } catch(e){}
  try { generarReporte(); } catch(e){}
  mostrarTicket(venta);
  clearCart();
  resetPosCliente();
  updateAlertCount();
}

let _fiadoPendiente = null; // recuerda un intento de fiado fallido para reintentar con el mismo id
// nota: _firmaCarrito ya está declarada en el Bloque 1 — no la repitas aquí

async function cobrarFiado() {
  if (cart.length === 0) { alert('El carrito está vacío'); return; }
  const clienteId = parseInt(document.getElementById('pos-cliente').value);
  if (!clienteId) { alert('Selecciona un cliente para registrar el fiado'); return; }
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  if (!(await _verificarLimiteGlobalPromos(cart))) return;

  const sub = Math.round(cart.reduce((s, i) => s + subtotalItemCarrito(i), 0) * 100) / 100;
  const desc = parseFloat(document.getElementById('pos-descuento').value) || 0;
  const comboInfo = calcComboDescuento(cart);
  const cantidadInfo = calcDescuentoCantidad(cart);
  const recargoInfo = calcRecargoPorLimitePromo(cart);
  const comboDesc = comboInfo.total;
  const cantidadDesc = cantidadInfo.total;
  const recargoDesc = recargoInfo.total;
  const total = Math.round(Math.max(0, sub - desc - comboDesc - cantidadDesc + recargoDesc) * 100) / 100;
  const itemsConPrecioReal = aplicarPreciosProporcionales(cart, comboInfo, cantidadInfo, recargoInfo);

  const firma = _firmaCarrito(cart, 'FIADO', clienteId);
  let fiado;
  if (_fiadoPendiente && _fiadoPendiente.firma === firma) {
    fiado = _fiadoPendiente.fiado;
  } else {
    // Comprobante electronico (SUNAT) — mismo criterio que procesarVenta(): se pide SOLO al
    // construir el fiado por primera vez, nunca en un reintento con el mismo carrito.
    const _comprobante = await _asignarComprobante('boleta');
    fiado = {
      id: getId(), clienteId,
      items: itemsConPrecioReal.map(i => {
        const prod = DB.productos.find(p => p.id === i.prodId);
        return { ...i, costoUnitario: prod ? prod.costo : 0 };
      }),
      total, pagado: 0, fecha: today(), hora: nowTime(), descuentoCombo: comboDesc, descuentoManual: desc, descuentoCantidad: cantidadDesc,
      sedeId: sedeAdminEfectiva(), estado: 'pendiente',
      comprobante: _comprobante
    };
  }
  _fiadoPendiente = { firma, fiado };

  if (!DB.historialVentas) DB.historialVentas = [];
  if (DB.historialVentas.some(v => v.id === fiado.id)) {
    _fiadoPendiente = null;
    alert('Fiado registrado para ' + getClienteNombre(clienteId) + ': ' + sol(total));
    clearCart();
    resetPosCliente();
    return;
  }

  // Validar antes de tocar nada.
  for (const item of cart) {
    const prod = DB.productos.find(p => p.id === item.prodId);
    if (!prod) {
      alert('⚠️ No se pudo registrar el fiado: "' + (item.nombre||item.prodId) + '" ya no existe en el catálogo.\n\nNo se guardó nada. Revisa el carrito e intenta de nuevo.');
      _fiadoPendiente = null;
      return;
    }
  }

  // ── Mismo paquete atómico que procesarVenta(): stock, fiado, cliente y movimiento juntos
  // en un solo lote — todo o nada. La caja NO recibe ingreso acá (un fiado no es efectivo en
  // mano todavía), solo se registra el movimiento para el rastro.
  const sede = sedeAdminEfectiva();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const batch = writeBatchM(dbModular);
  const _deltasPorProducto = new Map();
  const _acumular = (prod, delta) => {
    const actual = _deltasPorProducto.get(prod.id);
    if (actual) actual.delta += delta;
    else _deltasPorProducto.set(prod.id, { prod, delta });
  };
  cart.forEach(item => {
    const prod = DB.productos.find(p => p.id === item.prodId);
    if (!prod.esCombo) _acumular(prod, -item.cant);
    if (prod.esCombo && prod.componentes) {
      prod.componentes.forEach(comp => {
        const cp = DB.productos.find(x => x.id === comp.prodId);
        if (cp) _acumular(cp, -(comp.cant * item.cant));
      });
    }
  });
  const _deltasStock = [];
  for (const { prod, delta } of _deltasPorProducto.values()) {
    if ((prod.stock || 0) + delta < 0) {
      alert('⚠️ No se pudo registrar el fiado: no hay stock suficiente de "' + prod.nombre + '" en este momento.\n\nNo se guardó nada. Revisa el carrito e intenta de nuevo.');
      _fiadoPendiente = null;
      return;
    }
  }
  _deltasPorProducto.forEach(({prod, delta}) => {
    batch.set(docM(dbModular, 'productos', String(prod.id)),
      { stock: incrementM(delta) }, { merge: true });
    _deltasStock.push({ prod, delta });
  });
  const _promosConLimiteEnFiado = DB.promociones.filter(p => {
    if (!(p.activa && p.hasta >= today() && p.limite > 0)) return false;
    if (p.packProdId) return cart.some(i => i.prodId === p.packProdId);
    return cart.some(i => i.prodId == p.prod1);
  });
  _promosConLimiteEnFiado.forEach(promo => {
    const item = cart.find(i => (promo.packProdId ? i.prodId === promo.packProdId : i.prodId == promo.prod1));
    if (!item) return;
    batch.set(docM(dbModular, 'promociones', String(promo.id)), { vendidos: incrementM(item.cant) }, { merge: true });
  });

  batch.set(docM(dbModular, 'fiados', String(fiado.id)), { ...fiado, sedeId: sede });

  const _ventaFiado = { ...fiado, sedeId: sede, origen: 'pos', estado: 'fiado', estadoStock: 'descontado' };
  batch.set(docM(dbModular, 'ventas', String(fiado.id)), _ventaFiado);

  const _movId = getId();
  const _movData = { id: _movId, tipo:'fiado', desc:'Fiado — ' + getClienteNombre(clienteId), monto:total, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  const _puntosGanados = calcularPuntosGanados(itemsConPrecioReal);
  batch.set(docM(dbModular, 'clientes', String(clienteId)), {
    deuda: incrementM(total),
    compras: incrementM(1),
    total: incrementM(total),
    puntos: incrementM(_puntosGanados)
  }, { merge: true });

  _sincIniciar('fiado_lote', fiado.id);
  try {
    await batch.commit();
    _sincTerminar('fiado_lote', fiado.id);
  } catch (e) {
    _sincError('fiado_lote', fiado.id, e, 'el fiado completo (stock, deuda del cliente) — no se aplicó nada');
    _fiadoPendiente = null;
    return;
  }

  _deltasStock.forEach(({prod, delta}) => {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
  });
  DB.fiados.push(fiado);
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (cli) {
    _clienteProxySkipSync = true;
    try {
      _aplicarDeudaLocal(cli, total);
      cli.compras = (cli.compras||0) + 1;
      cli.total = (cli.total||0) + total;
      cli.puntos = (cli.puntos||0) + _puntosGanados;
    } finally { _clienteProxySkipSync = false; }
  }
  DB.historialVentas.push(_ventaFiado);
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  fbGuardar();

  _fiadoPendiente = null;
  try { renderDashboard(); } catch(e){}
  try { renderCaja(); } catch(e){}
  mostrarTicket(_ventaFiado);
  clearCart();
  resetPosCliente();
  updateAlertCount();
}

// ===================== TICKET =====================
function mostrarTicket(venta) {
  const cfg = DB.config || {};
  const cfgNombre = cfg.nombre || 'Tienda Aleze';
  const cfgMsg    = cfg.ticketMsg || '¡Gracias por su compra!';
  const comboDescuento = venta.descuentoCombo || 0;
  const cantidadDescuento = venta.descuentoCantidad || 0;
  const descManual = venta.descuentoManual || ((comboDescuento === 0 && cantidadDescuento === 0) ? (venta.descuento||0) : 0);
  const html = `<div class="ticket" id="ticket-print">
    <div class="ticket-center"><strong style="font-size:1rem">${cfgNombre}</strong></div>
    ${cfg.telefono ? `<div class="ticket-center" style="font-size:0.7rem">Tel: ${cfg.telefono}</div>` : ''}
    <div class="ticket-line"></div>
    <div class="ticket-row"><span>Fecha:</span><span>${formatDate(venta.fecha)}</span></div>
    <div class="ticket-row"><span>Hora:</span><span>${venta.hora}</span></div>
    <div class="ticket-row"><span>Cajero:</span><span>${venta.cajero}</span></div>
    ${venta.estado === 'fiado'
      ? '<div class="ticket-row" style="font-weight:700;color:#B45309"><span>📋 FIADO</span><span>Pendiente de pago</span></div>'
      : `<div class="ticket-row"><span>Pago:</span><span>${venta.metodo}</span></div>`}
    <div class="ticket-line"></div>
    ${venta.items.map(i => {
      const tag = i.enCombo ? ' 🎁' : (i.enPromoCantidad ? ' 🏷️' : '');
      return `<div class="ticket-row"><span>${i.nombre}${tag} x${i.tipo==='granel'?Math.round(i.cant*1000)+'g':i.cant}</span><span>${sol(subtotalItemCarrito(i))}</span></div>`;
    }).join('')}
    <div class="ticket-line"></div>
    ${comboDescuento > 0 ? `<div class="ticket-row" style="color:#6c3fff"><span>🎁 Dcto. combo:</span><span>-${sol(comboDescuento)}</span></div>` : ''}
    ${cantidadDescuento > 0 ? `<div class="ticket-row" style="color:#6c3fff"><span>🏷️ Dcto. cantidad:</span><span>-${sol(cantidadDescuento)}</span></div>` : ''}
    ${descManual > 0 ? `<div class="ticket-row"><span>Descuento:</span><span>-${sol(descManual)}</span></div>` : ''}
    <div class="ticket-row"><strong>TOTAL</strong><strong>${sol(venta.total)}</strong></div>
    <div class="ticket-line"></div>
    ${_fidelizacionTicketHtml(venta.clienteId)}
    <div class="ticket-center" style="color:#666">${cfgMsg}</div>
  </div>`;
  document.getElementById('ticket-content').innerHTML = html;
  _actualizarPremioBoxTicket(venta.clienteId);
  abrirModal('modal-ticket');
}

// Con el modelo nuevo (puntos = dinero directo, sin premios escalonados) no hay motivo para
// ocultar el valor en soles como antes — es justamente lo transparente que se buscaba.
function _fidelizacionTicketHtml(clienteId) {
  if (!clienteId) return '';
  const est = estadoFidelizacion(clienteId);
  if (est.valorCanjeable > 0) {
    return `<div class="ticket-center">🎁 Tienes <strong>${est.saldo} puntos</strong> — canjeable por ${sol(est.valorCanjeable)}</div><div class="ticket-line"></div>`;
  }
  return '';
}

// Misma info que en el ticket impreso, pero en la caja destacada que ve el cajero en pantalla.
function _actualizarPremioBoxTicket(clienteId) {
  const pb = document.getElementById('premio-box');
  if (!pb) return;
  if (!clienteId) { pb.style.display = 'none'; return; }
  const est = estadoFidelizacion(clienteId);
  if (est.valorCanjeable > 0) {
    pb.style.display = 'block';
    document.getElementById('premio-txt').innerHTML = `<strong>${getClienteNombre(clienteId)}</strong> tiene ${est.saldo} pts — canjeable por <strong>${sol(est.valorCanjeable)}</strong>`;
  } else {
    pb.style.display = 'none';
  }
}

function imprimirTicket() { window.print(); }

// ===================== POS - Cliente info y premio =====================
function onClienteChange() {
  const id = parseInt(document.getElementById('pos-cliente').value);
  const inf = document.getElementById('pos-cli-info');
  if (!id) {
    inf.style.display = 'none';
    const alertDiv = document.getElementById('pos-premio-alert');
    if (alertDiv) alertDiv.style.display = 'none';
    return;
  }
  const c = DB.clientes.find(x => x.id === id);
  if (!c) { inf.style.display = 'none'; return; }
  inf.style.display = 'block';
  document.getElementById('pos-cli-nombre').textContent = (c.alias||c.nombre) + ' ';
  const est = estadoFidelizacion(id);
  const fidTxt = est.valorCanjeable > 0 ? `🎁 ${est.saldo} pts (canjeable: ${sol(est.valorCanjeable)})` : (est.saldo + ' pts');
  document.getElementById('pos-cli-consumo').textContent = 'Consumo año: ' + sol(c.total) + ' | ' + fidTxt;
  // Mostrar alerta de premio sin interrumpir
  actualizarPremioAlertPOS();
}

function abrirCliRapido() {
  document.getElementById('cr-nombre').value = '';
  document.getElementById('cr-tel').value = '';
  abrirModal('modal-cli-rapido');
}

function guardarCliRapido() {
  const nombre = document.getElementById('cr-nombre').value.trim();
  if (!nombre) { alert('Ingresa un nombre'); return; }
  const tel = document.getElementById('cr-tel').value.trim();
  if (tel && tel.replace(/\D/g,'').length !== 9) { alert('El teléfono debe tener 9 dígitos (formato de celular en Perú).'); return; }
  const _existente = tel ? DB.clientes.find(x => (x.tel||'').replace(/\D/g,'') === tel.replace(/\D/g,'')) : null;
  if (_existente && !confirm(`Ya existe un cliente con este teléfono: "${_existente.nombre}".\n\n¿Confirmas que es una persona distinta y quieres crear un registro nuevo de todas formas?`)) {
    return;
  }
  const data = { nombre, alias: nombre, tel, dir: '', cumple: '', compras: 0, total: 0, deuda: 0 };
  const c = _envolverCliente({ id: getId(), ...data });
  DB.clientes.push(c);
  _guardarClienteDirecto(c.id, { id: c.id, ...data, puntos: 0 }, true);
  updatePosClientes();
  document.getElementById('pos-cliente').value = c.id;
  const _bd = document.getElementById('pos-cliente-buscar'); if (_bd) _bd.value = c.alias || c.nombre;
  // onClienteChange() ya actualiza toda la info del cliente — no hace falta nada más acá.
  onClienteChange();
  cerrarModal('modal-cli-rapido');
}

// ===================== MOBILE SIDEBAR OVERLAY =====================
function toggleMobSidebar() {
  const aside = document.getElementById('sidebar');
  const overlay = document.getElementById('mob-sidebar-overlay');
  const isOpen = aside.classList.contains('mob-open');
  if (isOpen) {
    aside.classList.remove('mob-open');
    overlay.classList.remove('open');
  } else {
    aside.classList.add('mob-open');
    overlay.classList.add('open');
  }
}
function closeMobSidebar() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('mob-sidebar-overlay').classList.remove('open');
}

// ===================== SIDEBAR TOGGLE =====================
let sidebarCollapsed = false;

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  const aside = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (sidebarCollapsed) {
    aside.classList.add('collapsed');
    btn.textContent = '▶';
    btn.title = 'Expandir menú';
  } else {
    aside.classList.remove('collapsed');
    btn.textContent = '◀';
    btn.title = 'Colapsar menú';
  }
}

// ===================== POS TABS MÓVIL =====================


// ===================== MOBILE POS =====================
// cart[] ya declarado globalmente — sistema unificado

function isMobile() { return window.innerWidth <= 760; }

// updateMobPosClientes() y mobOnClienteChange() retiradas — código muerto (mob-pos-cliente
// ya no existe). El panel de cliente compartido se actualiza directo desde onClienteChange().

function mobFilterPos() {
  const s = document.getElementById('mob-pos-search').value.toLowerCase();
  const activeCat = document.querySelector('#mob-pos-categorias .tag.active');
  const catId = activeCat ? activeCat.dataset.cat : '';
  let prods = DB.productos;
if (s) prods = prods.filter(p => _norm(p.nombre).includes(_norm(s)) || _norm(p.codigo||'').includes(_norm(s)));
  if (catId) prods = prods.filter(p => p.cat == catId);
  renderMobPosGrid(prods);
}

function renderMobPosCats() {
  const el = document.getElementById('mob-pos-categorias');
  if (!el) return;
  const catPromo = DB.categorias.find(c => c.nombre === 'Promociones');
  const otrosCats = DB.categorias.filter(c => c.nombre !== 'Promociones');
  const catsOrdenadas = catPromo ? [catPromo, ...otrosCats] : otrosCats;
  const cats = [{ id: '', emoji: '🏪', nombre: 'Todos', imagen: null }, ...catsOrdenadas];
  el.innerHTML = cats.map(c => {
    const icon = c.imagen
      ? `<img src="${c.imagen}" style="width:14px;height:14px;object-fit:cover;border-radius:2px;vertical-align:middle;margin-right:2px"/>`
      : (c.emoji + ' ');
    return `<span class="tag${c.id === '' ? ' active' : ''}" data-cat="${c.id}" onclick="mobSelectCat('${c.id}',this)">${icon}${c.nombre}</span>`;
  }).join('');
}

function mobSelectCat(catId, el) {
  document.querySelectorAll('#mob-pos-categorias .tag').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  mobFilterPos();
}

function renderMobPosGrid(prods) {
   prods = prods || DB.productos.filter(p => (stockEnSede(p) > 0) && (!p.esCombo || p.promoActiva !== false));
  const grid = document.getElementById('mob-pos-grid');
  if (!grid) return;
  const promoActivas = DB.promociones.filter(p => p.activa && p.hasta >= today() && _promoAplicaSede(p, currentUserSedeId || 'principal'));
  grid.innerHTML = prods.map(p => {
    const promoDelProducto = p.esCombo
      ? promoActivas.find(pr => pr.packProdId === p.id)
      : promoActivas.find(pr => !pr.packProdId && pr.prod1 == p.id && !pr.prod2);
    const esPromoCantidadM = promoDelProducto && (promoDelProducto.tipo === '2x1' || promoDelProducto.tipo === '3x2');
    const precio = (p.esCombo || esPromoCantidadM) ? p.precio : (promoDelProducto ? promoDelProducto.precioPromo : p.precio);
    const precioOrigM = (!esPromoCantidadM && promoDelProducto && promoDelProducto.precioOrig > precio) ? promoDelProducto.precioOrig : null;
    const pctDescM = precioOrigM ? Math.round((1 - precio / precioOrigM) * 100) : 0;
    const tag = promoDelProducto
      ? `<span class="promo-tag" style="position:absolute;top:4px;right:4px;font-size:.68rem">${esPromoCantidadM ? promoDelProducto.tipo : (pctDescM > 0 ? `-${pctDescM}%` : (p.esCombo ? 'OFERTA' : 'PROMO'))}</span>`
      : '';
    const stockBajo = stockEnSede(p) <= p.stockMin;
    const iconHtml = p.imagen
      ? `<div class="p-img-wrap"><img src="${p.imagen}" alt="${p.nombre}"></div>`
      : `<div class="p-img-wrap"><div class="p-icon">${getCatIcono(p.cat)}</div></div>`;
    const _stockSede = stockEnSede(p);
    return `<div class="product-card${_stockSede === 0 && !p.esCombo ? ' opacity-50' : ''}${promoDelProducto?' en-oferta':''}" onclick="mobAddToCart(${p.id})" style="${_stockSede===0 && !p.esCombo?'opacity:.45;pointer-events:none':''}">
      ${tag}
      ${iconHtml}
      <div class="p-info">
        <div class="p-name">${p.nombre}</div>
        <div class="p-price" style="${stockBajo?'color:var(--danger)':''}">${precioOrigM ? `<span class="p-price-orig">S/ ${precioOrigM.toFixed(2)}</span> ` : ''}S/ ${precio.toFixed(2)}</div>
        <div class="p-stock" style="${stockBajo?'color:var(--danger);font-weight:700':''}">Stock: ${_stockSede} ${p.unidad}</div>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--gray-400);text-align:center;padding:2rem;grid-column:1/-1">Sin productos</p>';
}

// ---- MOB CART ----
function mobAddToCart(prodId) {
  const prod = DB.productos.find(p => p.id === prodId);
  if (!prod || stockEnSede(prod) === 0) return;
  const promoActivas = DB.promociones.filter(p => p.activa && p.hasta >= today() && _promoAplicaSede(p, currentUserSedeId || 'principal'));
  const promo = promoActivas.find(pr => !pr.packProdId && pr.prod1 == prodId && !pr.prod2);
  const esPromoCantidadM2 = promo && (promo.tipo === '2x1' || promo.tipo === '3x2');
  const precio = (promo && !esPromoCantidadM2) ? promo.precioPromo : prod.precio;
  const existing = cart.find(i => i.prodId === prodId);
  if (prod.esCombo) {
    const promoPack = promoActivas.find(pr => pr.packProdId === prodId);
    if (promoPack && promoPack.maxPorVenta > 0 && (existing ? existing.cant : 0) >= promoPack.maxPorVenta) {
      alert(`Máximo ${promoPack.maxPorVenta} unidad(es) de este pack por venta.`);
      return;
    }
  }
  if (promo && promo.maxPorVenta > 0 && existing && existing.cant === promo.maxPorVenta) {
    alert(`⚠️ Ya se alcanzó el máximo de ${promo.maxPorVenta} unidad(es) con precio promocional de "${prod.nombre}". Las siguientes se cobran al precio normal (${sol(prod.precio)}).`);
  }
  if (existing) {
    if (existing.cant >= stockEnSede(prod)) { alert('Stock insuficiente'); return; }
    existing.cant++;
  } else {
    // CRITICO - bug real confirmado: el valor inicial para granel era 0.5, pero el click
    // siguiente (existing.cant++, mas abajo) SIEMPRE suma exactamente 1, sin importar el tipo
    // de producto. La combinacion daba 0.5 + 1 = 1.5 en el segundo click, no 1.0 como se
    // esperaria. Arreglado para que el primer click TAMBIEN sume 1, consistente con los
    // siguientes — el peso exacto se ajusta despues con el campo de gramos, no a los clicks.
    cart.push({ prodId, nombre: prod.nombre, precio, cant: 1, tipo: prod.tipo, unidad: prod.unidad });
  }
  mobRenderCart();
  mobCalcTotal();
  mobUpdateBar();
  // Badge update — drawer NO se abre automáticamente (opción B)
  try { updatePosCartBadge(); } catch(e) {}
}

function mobRenderCart() {
  // Delegado al renderCart unificado — única fuente de verdad UI
  renderCart();
  try { updatePosCartBadge(); } catch(e) {}
}

function mobCalcTotal() {
  // Delegado al calcTotal unificado
  calcTotal();
  mobUpdateBar();
}

function mobUpdateBar() {
  const count = cart.reduce((s, i) => s + i.cant, 0);
  const btnBadge = document.getElementById('mob-pos-cart-badge-btn');
  if (btnBadge) { btnBadge.textContent = count; btnBadge.style.display = count > 0 ? 'inline' : 'none'; }
}

function toggleMobCart() {
  // Unificado: usa el drawer principal pos-cart-panel
  const panel = document.getElementById('pos-cart-panel');
  if (!panel) return;
  if (panel.classList.contains('drawer-open')) {
    cerrarCartDrawer();
  } else {
    renderCart(); calcTotal();
    abrirCartDrawer();
  }
}

// mobProcesarVenta() y mobCobrarFiado() se retiraron — codigo muerto confirmado, sin ningun
// disparador en todo el archivo. El carrito movil usa el mismo panel compartido que
// escritorio (ver toggleMobCart), asi que procesarVenta()/cobrarFiado() ya cubren movil.

function renderMobPos() {
  if (!isMobile()) return;
  renderMobPosCats();
  renderMobPosGrid();
  mobRenderCart();
  mobUpdateBar();
  // paddingBottom eliminado — layout controlado por CSS
}

