// ===================== PROVEEDORES =====================
let editingProvId = null;

function renderProveedores() {
  const qNombre = (document.getElementById('prov-buscar')?.value || '').toLowerCase();
  const qBoleta = (document.getElementById('prov-buscar-boleta')?.value || '').toLowerCase();
  let provs = DB.proveedores;
  if (qNombre) provs = provs.filter(p => _norm(p.nombre).includes(_norm(qNombre)));
  if (qBoleta) provs = provs.filter(p => (p.boletas||[]).some(b => _norm(b.num).includes(_norm(qBoleta))));
  document.getElementById('prov-tbody').innerHTML = provs.map(p => {
    const debe = (p.boletas||[]).reduce((s,b) => s + Math.max(0, (b.monto||0) - (b.pagado||0)), 0);
    return `<tr>
    <td><strong>${p.nombre}</strong></td><td>${p.contacto}</td><td>${p.tel}</td>
    <td style="font-size:0.8rem">${p.productos}</td>
    <td><button class="btn btn-xs btn-outline" onclick="verBoletas(${p.id})">📄 ${(p.boletas||[]).length} boleta(s)</button>${debe > 0 ? `<div style="font-size:.72rem;color:var(--danger);font-weight:700">Debe ${sol(debe)}</div>` : ''}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-outline btn-xs" onclick="editarProveedor(${p.id})">✏️ Editar</button>
      <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarProveedor(${p.id})">🗑️</button>
    </td>
  </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin proveedores</td></tr>';
}
function limpiarFiltrosProveedores() {
  const el1 = document.getElementById('prov-buscar');
  const el2 = document.getElementById('prov-buscar-boleta');
  if (el1) el1.value = '';
  if (el2) el2.value = '';
  renderProveedores();
}
function abrirModalProveedor() {
  editingProvId = null;
  editingBoletaProvId = null;
  document.getElementById('prov-modal-titulo').textContent = 'Nuevo Proveedor';
  ['prov-nombre','prov-contacto','prov-tel','prov-productos'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('prov-btn-boletas').style.display = 'none'; // recién existe una vez guardado
  abrirModal('modal-proveedor');
}

function editarProveedor(id) {
  editingProvId = id;
  editingBoletaProvId = id;
  const p = DB.proveedores.find(x => x.id === id);
  document.getElementById('prov-modal-titulo').textContent = 'Editar: ' + p.nombre;
  document.getElementById('prov-nombre').value = p.nombre;
  document.getElementById('prov-contacto').value = p.contacto;
  document.getElementById('prov-tel').value = p.tel;
  document.getElementById('prov-productos').value = p.productos;
  document.getElementById('prov-btn-boletas').style.display = 'inline-block';
  abrirModal('modal-proveedor');
}

function guardarProveedor() {
  if (currentRole !== 'admin') return;
  const nombre = document.getElementById('prov-nombre').value.trim();
  if (!nombre) { alert('Ingresa el nombre'); return; }
  const data = { nombre, contacto: document.getElementById('prov-contacto').value, tel: document.getElementById('prov-tel').value, productos: document.getElementById('prov-productos').value };
  // CRITICO: proveedores ahora tiene su propia coleccion (mismo criterio que ventas, clientes,
  // promociones, etc.). boletas NUNCA se guarda como parte de este documento — ya vive en su
  // propia coleccion boletas/{id} desde antes; guardarla tambien acá era la duplicidad real.
  // El array prov.boletas sigue existiendo en memoria (se reconstruye al cargar, agrupando la
  // coleccion boletas por proveedorId) para no tener que tocar toda la lectura existente.
  let _provFinal;
  if (editingProvId) {
    const p = DB.proveedores.find(x => x.id === editingProvId);
    Object.assign(p, data);
    _provFinal = p;
  } else {
    _provFinal = { id: getId(), ...data, boletas: [] };
    DB.proveedores.push(_provFinal);
  }
  if (dbModular) { // [SDK modular]
    const { boletas, ...provSinBoletas } = _provFinal;
    setDocM(docM(dbModular, 'proveedores', String(_provFinal.id)), provSinBoletas).catch(e => console.warn('No se pudo guardar proveedores/'+_provFinal.id, e));
  }
  cerrarModal('modal-proveedor');
  renderProveedores();
}

function eliminarProveedor(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar proveedores.'); return; }
  // Un producto puede tener varios proveedores — ver _provsDeProducto() en inventario.js.
  const prodsAsociados = DB.productos.filter(p => _provsDeProducto(p).some(pid => pid == id));
  if (prodsAsociados.length > 0) {
    if (!confirm(`Este proveedor tiene ${prodsAsociados.length} producto(s) asociado(s).\n¿Deseas eliminarlo de todas formas? Este proveedor dejará de aparecer en la lista de esos productos (si tenían otros proveedores además de este, esos se conservan).`)) return;
  } else {
    if (!confirm('¿Eliminar proveedor?')) return;
  }
  const prov = DB.proveedores.find(p => p.id === id);
  // Limpia tambien las boletas de este proveedor en su coleccion propia — si no, quedan huerfanas.
  if (dbModular && prov && prov.boletas) { // [SDK modular]
    prov.boletas.forEach(b => deleteDocM(docM(dbModular, 'boletas', String(b.id))).catch(()=>{}));
  }
  if (dbModular) deleteDocM(docM(dbModular, 'proveedores', String(id))).catch(e => console.warn('No se pudo borrar proveedores/'+id, e));
  DB.proveedores = DB.proveedores.filter(p => p.id !== id);
  renderProveedores();
}

let editingBoletaProvId = null;
let _boletaProductos = []; // Productos recibidos en la boleta actual (temporal)
function abrirAgregarBoleta() {
  if (currentRole !== 'admin') return;
  if (!editingBoletaProvId) { alert('Selecciona un proveedor primero.'); return; }
  const prov = DB.proveedores.find(x => x.id === editingBoletaProvId);
  document.getElementById('nb-proveedor-nombre').textContent = prov ? prov.nombre : '';
  document.getElementById('bol-num').value = '';
  document.getElementById('bol-fecha').value = today();
  document.getElementById('bol-monto').value = '';
  document.getElementById('bol-url').value = '';
  document.getElementById('bol-desc').value = '';
  document.getElementById('bol-prod-nuevo').style.display = 'none';
  _boletaProductos = [];
  _boletaRenderLista();
  cerrarModal('modal-boletas-proveedor');
  abrirModal('modal-nueva-boleta');
}
function cerrarAgregarBoleta() {
  _boletaProductos = [];
  const buscar = document.getElementById('bol-prod-buscar');
  if (buscar) buscar.value = '';
  const sug = document.getElementById('bol-prod-sugerencias');
  if (sug) sug.style.display = 'none';
  cerrarModal('modal-nueva-boleta');
  abrirModal('modal-boletas-proveedor');
}
// ── Puebla el selector de proveedor del modal de boletas (usado en ambas entradas: directa y desde un proveedor) ──
function _boletaPoblarSelector() {
  const sel = document.getElementById('bolprov-selector');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecciona un proveedor —</option>' +
    DB.proveedores.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
}

// ── Entrada rápida: botón "Nueva Boleta" a nivel principal, junto a "Nuevo Proveedor" — no exige entrar al proveedor primero ──
function abrirNuevaBoletaDirecta() {
  editingBoletaProvId = null;
  _boletaPoblarSelector();
  document.getElementById('bolprov-selector').value = '';
  limpiarFiltrosBoletas();
  abrirModal('modal-boletas-proveedor');
}

// ── Cambio de proveedor dentro del modal — recarga su historial sin cerrar nada ──
function _boletaSeleccionarProveedor() {
  const val = document.getElementById('bolprov-selector').value;
  editingBoletaProvId = val ? parseInt(val) : null;
  limpiarFiltrosBoletas();
}

function verBoletas(provId) {
  editingBoletaProvId = provId;
  _boletaPoblarSelector();
  document.getElementById('bolprov-selector').value = provId;
  limpiarFiltrosBoletas();
  cerrarModal('modal-proveedor');
  abrirModal('modal-boletas-proveedor');
}
function filtrarBoletas() {
  if (!editingBoletaProvId) {
    document.getElementById('boletas-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--gray-400)">👆 Selecciona un proveedor arriba para ver o registrar boletas</td></tr>';
    return;
  }
  const prov = DB.proveedores.find(x => x.id === editingBoletaProvId);
  const desde = document.getElementById('bol-filtro-desde')?.value || '';
  const hasta = document.getElementById('bol-filtro-hasta')?.value || '';
  const boletas = (prov && prov.boletas) ? prov.boletas : [];
  let filtradas = boletas;
  if (desde) filtradas = filtradas.filter(b => b.fecha >= desde);
  if (hasta) filtradas = filtradas.filter(b => b.fecha <= hasta);
  const total = filtradas.reduce((s, b) => s + (b.monto||0), 0);
 document.getElementById('boletas-tbody').innerHTML = filtradas.map((b, idx) => {
   const pendiente = Math.round(((b.monto||0) - (b.pagado||0)) * 100) / 100;
   return `<tr>
    <td>${b.num}</td><td>${formatDate(b.fecha)}</td><td>${b.desc||'-'}</td>
    <td>${sol(b.monto||0)}${pendiente > 0 ? `<div style="font-size:.7rem;color:var(--danger)">Pendiente: ${sol(pendiente)}</div>` : '<div style="font-size:.7rem;color:var(--accent)">✅ Pagada</div>'}</td>
    <td>${b.url?`<a href="${b.url}" target="_blank" style="color:var(--primary)">🔗 Ver</a>`:'-'}</td>
    <td style="white-space:nowrap">
      ${pendiente > 0 ? `<button class="btn btn-xs btn-outline" onclick="abrirPagoBoleta(${editingBoletaProvId}, ${boletas.indexOf(b)})">💰 Pagar</button>` : ''}
      <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarBoleta(${boletas.indexOf(b)})">🗑️</button>
    </td>
  </tr>`;
  }).join('') +
  (filtradas.length > 0 ? `<tr style="background:var(--gray-50);font-weight:700"><td colspan="3">Total: ${filtradas.length} boleta(s)</td><td>${sol(total)}</td><td colspan="2"></td></tr>` : '') ||
  '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:1rem">Sin boletas registradas</td></tr>';
}
async function eliminarBoleta(idx) {
  if (currentRole !== 'admin') return;
  const prov = DB.proveedores.find(x => x.id === editingBoletaProvId);
  if (!prov || !prov.boletas) return;
  const boleta = prov.boletas[idx];
  if (!boleta) return;
  const tieneProductos = boleta.productos && boleta.productos.length > 0;
  let _revertirStock = false;
  if (tieneProductos) {
    const lista = boleta.productos.map(p =>
      `• ${p.nombre}: ${p.cantidad} unid${p.esBonif ? ' (bonif.)' : ''}`
    ).join('\n');
    _revertirStock = confirm(
      `La boleta N° ${boleta.num} tiene productos asociados:\n\n${lista}\n\n` +
      `¿Deseas REVERTIR el stock de estos productos?\n\n` +
      `✅ Aceptar = Revertir stock (recomendado si fue un error)\n` +
      `❌ Cancelar = Solo eliminar la boleta, mantener stock`
    );
  } else {
    if (!confirm(`¿Eliminar la boleta N° ${boleta.num}?`)) return;
  }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  // Paquete atomico: reversion de stock (si aplica) y borrado de boleta viajan juntos.
  const batch = writeBatchM(dbModular);
  const _deltasPorProducto = new Map();
  if (_revertirStock) {
    boleta.productos.forEach(p => {
      const prod = DB.productos.find(x => x.id === p.prodId);
      if (prod) {
        const actual = _deltasPorProducto.get(prod.id);
        if (actual) actual.delta -= p.cantidad;
        else _deltasPorProducto.set(prod.id, { prod, delta: -p.cantidad });
      }
    });
    _deltasPorProducto.forEach(({prod, delta}) => {
      batch.set(docM(dbModular, 'productos', String(prod.id)),
        { stock: incrementM(delta) }, { merge: true });
    });
  }
  const _boletaIdEliminada = boleta.id;
  if (_boletaIdEliminada != null) batch.delete(docM(dbModular, 'boletas', String(_boletaIdEliminada)));

  _sincIniciar('elim_boleta_lote', _boletaIdEliminada ?? idx);
  try {
    await batch.commit();
    _sincTerminar('elim_boleta_lote', _boletaIdEliminada ?? idx);
  } catch (e) {
    _sincError('elim_boleta_lote', _boletaIdEliminada ?? idx, e, 'la eliminación de la boleta — no se aplicó nada');
    return;
  }

  _deltasPorProducto.forEach(({prod, delta}) => {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
  });
  // Nota: si _revertirStock, ese stock ya se escribio correctamente en el batch atomico de arriba.
  prov.boletas.splice(idx, 1);
  fbGuardar();
  renderProveedores();
  filtrarBoletas();
}
function limpiarFiltrosBoletas() {
  const els = ['bol-filtro-desde','bol-filtro-hasta'];
  els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  filtrarBoletas();
}

// ── Boleta: búsqueda y gestión de productos recibidos ──
function _boletaBuscar() {
  const q = (document.getElementById('bol-prod-buscar')?.value || '').toLowerCase().trim();
  const sug = document.getElementById('bol-prod-sugerencias');
  if (!sug) return;
  if (!q) { sug.style.display = 'none'; return; }
  const matches = DB.productos.filter(p =>
_norm(p.nombre).includes(_norm(q)) || _norm(p.codigo||'').includes(_norm(q))
  ).slice(0, 8);
  const crearLink = `<div onclick="_boletaAbrirCrearProducto()" style="padding:.5rem .75rem;cursor:pointer;color:var(--primary);font-weight:600;border-top:1px solid var(--gray-100)">+ Crear producto nuevo</div>`;
  if (!matches.length) {
    sug.innerHTML = '<div style="padding:.5rem;color:var(--gray-400)">Sin resultados</div>' + crearLink;
  } else {
    sug.innerHTML = matches.map(p =>
      `<div onclick="_boletaAgregarProd(${p.id})" style="padding:.4rem .75rem;cursor:pointer;border-bottom:1px solid var(--gray-100)" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        <strong>${p.nombre}</strong> <span style="color:var(--gray-400);font-size:.78rem">Stock aquí: ${stockEnSede(p)} | S/${p.costo}</span>
       </div>`
    ).join('') + crearLink;
  }
  sug.style.display = 'block';
}

// ── Crear producto nuevo sin salir de la boleta — mínimo viable, se puede completar después en Inventario ──
function _boletaAbrirCrearProducto() {
  const q = document.getElementById('bol-prod-buscar').value.trim();
  document.getElementById('bol-prod-sugerencias').style.display = 'none';
  const el = document.getElementById('bol-prod-nuevo');
  el.innerHTML = `
    <div style="font-weight:700;font-size:.8rem;margin-bottom:.4rem;color:var(--primary)">+ Nuevo producto</div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem">
      <input type="text" id="bpn-nombre" class="form-control" placeholder="Nombre *" style="flex:2;min-width:120px" />
      <select id="bpn-cat" class="form-control" style="flex:1;min-width:100px">
        ${DB.categorias.map(c=>`<option value="${c.id}">${c.emoji||''} ${c.nombre}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem">
      <input type="number" id="bpn-precio" class="form-control" placeholder="Precio de venta S/ *" step="0.01" style="flex:1;min-width:110px" />
      <span style="font-size:.72rem;color:var(--gray-500);align-self:center">Costo y stock los define esta boleta</span>
    </div>
    <div style="display:flex;gap:.4rem;justify-content:flex-end">
      <button type="button" class="btn btn-outline btn-xs" onclick="document.getElementById('bol-prod-nuevo').style.display='none'">Cancelar</button>
      <button type="button" class="btn btn-primary btn-xs" onclick="_boletaCrearProducto()">Crear y agregar</button>
    </div>`;
  document.getElementById('bpn-nombre').value = q;
  el.style.display = 'block';
}

function _boletaCrearProducto() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede crear productos.'); return; }
  const nombre = document.getElementById('bpn-nombre').value.trim();
  const cat = parseInt(document.getElementById('bpn-cat').value);
  const precio = parseFloat(document.getElementById('bpn-precio').value);
  if (!nombre || !cat || isNaN(precio) || precio <= 0) { alert('Completa nombre, categoría y precio de venta.'); return; }
  const prod = {
    id: getId(), nombre, cat, tipo:'unidad', unidad:'unidad',
    costo: 0, precio, stock: 0, stockMin: 5, venc: '',
    codigo: '7' + getId().toString().slice(-12), prov: editingBoletaProvId, imagen: ''
  };
  DB.productos.push(prod);
  fbGuardarProducto(prod.id);
  document.getElementById('bol-prod-nuevo').style.display = 'none';
  document.getElementById('bol-prod-buscar').value = '';
  _boletaAgregarProd(prod.id);
}

function _boletaAgregarProd(id) {
  const prod = DB.productos.find(p => p.id === id);
  if (!prod) return;
  const existe = _boletaProductos.find(x => x.prodId === id);
  if (existe) {
    existe.cantidad++;
  } else {
    _boletaProductos.push({ prodId: id, nombre: prod.nombre, cantidad: 1, costo: prod.costo, esBonif: false });
  }
  document.getElementById('bol-prod-buscar').value = '';
  document.getElementById('bol-prod-sugerencias').style.display = 'none';
  _boletaRenderLista();
}

// Agrega una fila NUEVA e independiente para un producto que ya está en la lista — a
// diferencia de _boletaAgregarProd() (que suma cantidad a la fila existente), esto permite
// que el MISMO producto tenga 2 filas con costo distinto en la misma boleta: ej. 3 unidades
// pagadas a S/2.99 + 1 unidad de bonificación del proveedor (gratis). guardarBoleta() ya está
// preparado para 2+ filas del mismo prodId (agrupa por producto, suma cantidades y recalcula
// el costo promedio ponderado de forma secuencial — ver comentario "por si el mismo producto
// aparece dos veces en la boleta" más abajo), así que no hace falta tocar esa función: el
// costo promedio queda diluido SOLO por la cantidad realmente marcada como bonif, no por el
// total combinado. Cantidad por defecto 1 — editable igual que cualquier fila (una
// bonificación puede ser de más de 1 unidad).
function _boletaAgregarBonif(id) {
  const prod = DB.productos.find(p => p.id === id);
  if (!prod) return;
  _boletaProductos.push({ prodId: id, nombre: prod.nombre, cantidad: 1, costo: prod.costo, esBonif: true });
  _boletaRenderLista();
}

// Recibe la POSICIÓN en el arreglo, no el prodId — desde que un producto puede tener 2 filas
// (ver _boletaAgregarBonif() arriba), filtrar por prodId borraría AMBAS filas de un tirón.
function _boletaQuitarProd(idx) {
  _boletaProductos.splice(idx, 1);
  _boletaRenderLista();
}

// Costo Promedio Ponderado: mezcla el stock existente (a su costo) con la compra nueva.
// stockActual=0 (producto recién creado) -> el promedio es simplemente el costo de esta compra, correcto.
function _boletaCostoPromedio(stockActual, costoActual, cantNueva, costoNuevo) {
  const stockFinal = stockActual + cantNueva;
  if (stockFinal <= 0) return costoNuevo;
  return ((stockActual * costoActual) + (cantNueva * costoNuevo)) / stockFinal;
}

function _boletaRenderLista() {
  const el = document.getElementById('bol-prod-lista');
  if (!el) return;
  if (!_boletaProductos.length) {
    el.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:.5rem">Sin productos agregados aún</div>';
    _boletaActualizarTotal();
    return;
  }
const _unidadNombre = { und:'unidades', kg:'kg', g:'g', L:'L', ml:'ml' };
el.innerHTML = _boletaProductos.map((p, i) => {
    const prod = DB.productos.find(x => x.id === p.prodId);
    const stockActual = prod ? stockEnSede(prod) : 0;
    const stockGlobalAntes = prod ? stockTotal(prod) : 0;
    const costoActual = prod ? prod.costo : 0;
    const cantNueva = p.cantidad || 0;
    const stockFinal = Math.round((stockActual + cantNueva) * 1000) / 1000;
    const costoNuevo = p.esBonif ? 0 : (p.costo || 0);
    // Costo es compartido entre sedes — el promedio se pondera contra el stock GLOBAL, no solo el de esta sede
    const costoPromedio = _boletaCostoPromedio(stockGlobalAntes, costoActual, cantNueva, costoNuevo);
    const costoCambia = Math.abs(costoPromedio - costoActual) > 0.005;
    const precio = prod ? prod.precio : 0;
    const unidad = _unidadNombre[prod?.unidad] || 'unidades';
    const margenActual = precio > 0 ? ((precio - costoActual) / precio * 100).toFixed(1) : '—';
    const margenNuevo  = precio > 0 ? ((precio - costoPromedio) / precio * 100).toFixed(1) : '—';
    const margenColor  = margenNuevo !== '—' && margenActual !== '—' && parseFloat(margenNuevo) < parseFloat(margenActual) ? 'var(--danger)' : 'var(--accent)';
    return `
    <div style="background:var(--gray-50);border-radius:6px;padding:.5rem .6rem;margin-bottom:.4rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
        <span style="font-size:.82rem;font-weight:600">${p.nombre}</span>
        <button onclick="_boletaQuitarProd(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1rem;padding:0 2px">✕ quitar</button>
      </div>
      <div style="display:flex;align-items:flex-end;gap:.6rem;flex-wrap:wrap">
        <div>
          <label style="font-size:.68rem;color:var(--gray-500);display:block;margin-bottom:1px">Cantidad (${unidad})</label>
          <input type="number" min="0.01" step="0.01" value="${p.cantidad}" style="width:72px;padding:3px 5px;border:1px solid var(--gray-300);border-radius:4px;font-size:.8rem"
            onchange="_boletaProductos[${i}].cantidad=parseFloat(this.value)||1;_boletaRenderLista()" />
        </div>
        <div>
          <label style="font-size:.68rem;color:var(--gray-500);display:block;margin-bottom:1px">Costo unitario (S/)</label>
          <input type="number" min="0" step="0.01" value="${p.costo}" ${p.esBonif ? 'disabled style="width:72px;padding:3px 5px;border:1px solid var(--gray-300);border-radius:4px;font-size:.8rem;opacity:.45"' : 'style="width:72px;padding:3px 5px;border:1px solid var(--gray-300);border-radius:4px;font-size:.8rem"'}
            onchange="_boletaProductos[${i}].costo=parseFloat(this.value)||0;_boletaRenderLista()" />
        </div>
        <label style="font-size:.72rem;white-space:nowrap;display:flex;align-items:center;gap:2px;padding-bottom:4px">
          <input type="checkbox" ${p.esBonif?'checked':''} onchange="_boletaProductos[${i}].esBonif=this.checked;_boletaRenderLista()"> Bonif.
        </label>
      </div>
      <div style="display:flex;align-items:center;gap:.7rem;margin-top:.4rem;flex-wrap:wrap;font-size:.72rem;color:var(--gray-500)">
        <span>📦 Stock aquí: <b style="color:var(--gray-700)">${stockActual}</b> → <b style="color:var(--accent)">${stockFinal}</b></span>
        <span>💰 Costo (compartido entre sedes): <b style="color:var(--gray-700)">${sol(costoActual)}</b>${costoCambia ? ` → <b style="color:var(--warning)">${sol(costoPromedio)}</b> (promedio ponderado)` : ' (sin cambio)'}</span>
        <span>🧮 Subtotal: <b style="color:var(--gray-700)">${p.esBonif ? 'Bonif. (no suma)' : sol((p.cantidad||0)*(p.costo||0))}</b></span>
        <span>🏷️ Venta: <b style="color:var(--gray-700)">${sol(precio)}</b></span>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem;flex-wrap:wrap">
        <label style="font-size:.72rem;color:var(--gray-500)">Vence:</label>
        <input type="date" value="${p.venc||''}" style="font-size:.75rem;padding:2px 4px;border:1px solid var(--gray-200);border-radius:4px"
          onchange="_boletaProductos[${i}].venc=this.value" title="Fecha de vencimiento (opcional)" />
        <span style="font-size:.72rem;color:var(--gray-500)">Margen: <b style="color:${margenColor}">${margenNuevo}%</b> <span style="color:var(--gray-400)">(antes ${margenActual}%)</span></span>
      </div>
      <div style="text-align:right;margin-top:.3rem">
        <button type="button" onclick="_boletaAgregarBonif(${p.prodId})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:.7rem;padding:0" title="Agrega una fila NUEVA de este mismo producto, marcada como bonificación — no toca esta fila">🎁 Agregar bonificación de este producto</button>
      </div>
    </div>`;
  }).join('');
  _boletaActualizarTotal();
}

// ── Total cargado en vivo vs. importe declarado — reemplaza el aviso único de "al guardar" ──
function _boletaActualizarTotal() {
  const el = document.getElementById('bol-prod-total');
  if (!el) return;
  const totalCargado = Math.round(_boletaProductos.filter(p=>!p.esBonif).reduce((s,p) => s + (p.cantidad||0)*(p.costo||0), 0) * 100) / 100;
  const declarado = parseFloat(document.getElementById('bol-monto')?.value) || 0;
  if (!_boletaProductos.length && declarado === 0) { el.innerHTML = ''; return; }
  const dif = Math.round((declarado - totalCargado) * 100) / 100;
  let estado = '';
  if (declarado > 0) {
    if (dif === 0) estado = ' <span style="color:var(--accent)">✅ cuadra</span>';
    else if (dif > 0) estado = ` <span style="color:var(--warning)">(falta cargar ${sol(dif)})</span>`;
    else estado = ` <span style="color:var(--danger)">(sobra ${sol(Math.abs(dif))} sobre lo declarado)</span>`;
  }
  el.innerHTML = `Total cargado: <b>${sol(totalCargado)}</b>${declarado > 0 ? ` de ${sol(declarado)} declarado${estado}` : ''}`;
}
async function guardarBoleta() {
  if (currentRole !== 'admin') return;
  const num   = document.getElementById('bol-num').value.trim();
  const fecha = document.getElementById('bol-fecha').value;
  if (!num || !fecha) { alert('Ingresa número y fecha de la boleta'); return; }
  const prov = DB.proveedores.find(x => x.id === editingBoletaProvId);
  if (!prov) return;

  // ── Validar boleta duplicada ──
  if (prov.boletas && prov.boletas.some(b => b.num === num)) {
    if (!confirm(`⚠️ Ya existe una boleta N° "${num}" para este proveedor.\n¿Deseas guardarla de todas formas?`)) return;
  }

  // ── Validar productos si los hay ──
  if (_boletaProductos.length > 0) {
    const invalidos = _boletaProductos.filter(p => !p.cantidad || p.cantidad <= 0);
    if (invalidos.length) {
      alert(`❌ Cantidad inválida en: ${invalidos.map(p => p.nombre).join(', ')}\nRevisa que todas las cantidades sean mayores a 0.`);
      return;
    }
// ── Resumen de confirmación ──
    const totalProductos = _boletaProductos.reduce((s, p) => s + (p.esBonif ? 0 : p.cantidad * p.costo), 0);
    const montoIngresado = parseFloat(document.getElementById('bol-monto').value) || 0;
    const difMonto = montoIngresado > 0 ? Math.abs(montoIngresado - totalProductos) : null;
    const resumen = _boletaProductos.map(p =>
      `• ${p.nombre}: +${p.cantidad} ${p.esBonif ? '(Bonificación)' : `a S/${(+p.costo).toFixed(2)} = S/${(p.cantidad * p.costo).toFixed(2)}`}${p.venc ? ` | Vence: ${p.venc}` : ''}`
    ).join('\n');
    const alertaDif = difMonto !== null && difMonto > 0.5
      ? `\n\n⚠️ El total de productos (S/${totalProductos.toFixed(2)}) difiere del importe ingresado (S/${montoIngresado.toFixed(2)}) en S/${difMonto.toFixed(2)}. Verifica si hay productos no registrados.`
      : '';
    if (!confirm(`📦 Confirmar actualización de stock:\n\n${resumen}\n\nTotal productos: S/${totalProductos.toFixed(2)}${alertaDif}\n\n¿Continuar?`)) return;

    // Mitigación de costo pisado entre 2 boletas simultáneas (sede 1 y sede 2 recibiendo el
    // mismo producto casi al mismo tiempo): refresca costo/stock desde el servidor justo antes
    // de calcular el promedio ponderado — reduce la ventana de riesgo, no requiere transacción
    // (que exigiría estar online siempre, rompiendo el trabajo offline ya hecho).
    if (dbModular) { // [SDK modular]
      for (const p of _boletaProductos) {
        try {
          const _snapFresco = await getDocDelServidorM(docM(dbModular, 'productos', String(p.prodId)));
          if (_snapFresco.exists()) { // en modular, exists es un METODO, no una propiedad
            const _dataFresca = _snapFresco.data();
            const prodLocal = DB.productos.find(x => x.id === p.prodId);
            if (prodLocal) {
              prodLocal.costo = _dataFresca.costo;
              prodLocal.stock = _dataFresca.stock || 0;
            }
          }
        } catch(e) { console.warn('guardarBoleta: no se pudo refrescar ' + p.nombre + ' antes de aplicar, usando datos locales', e); }
      }
    }

    // ── Calcular stock y costo (Costo Promedio Ponderado) — el CALCULO sigue siendo
    // secuencial en memoria local (necesita el stock/costo actual paso a paso para ser
    // correcto), pero la ESCRITURA final va en un solo lote atomico junto con la boleta —
    // sin esto, el stock podia quedar recibido sin boleta que lo respalde, o viceversa.
    const _sedeBoleta = sedeAdminEfectiva();
    const _cambiosProductos = []; // {prod, costoNuevo, venc, delta} para el lote y para aplicar despues
    _boletaProductos.forEach(p => {
      const prod = DB.productos.find(x => x.id === p.prodId);
      if (!prod) return;
      const stockGlobalAntes = stockTotal(prod) + _cambiosProductos.filter(c=>c.prod.id===prod.id).reduce((s,c)=>s+c.delta,0);
      const costoBase = _cambiosProductos.filter(c=>c.prod.id===prod.id).slice(-1)[0]?.costoNuevo ?? (prod.costo || 0);
      const costoNuevo = p.esBonif ? 0 : (p.costo || 0);
      const costoPromedio = _boletaCostoPromedio(stockGlobalAntes, costoBase, p.cantidad, costoNuevo);
      _cambiosProductos.push({ prod, costoNuevo: Math.round(costoPromedio * 10000) / 10000, venc: p.venc, delta: p.cantidad });
    });

    if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
    // Firestore permite maximo 500 operaciones por lote — con boleta + 1 escritura de stock
    // por producto distinto, esto cubre hasta 499 productos distintos en una sola boleta, muy
    // por encima de cualquier factura real. Si algun dia se superara, mejor un mensaje claro
    // que un error criptico de Firestore.
    if (_boletaProductos.length > 490) {
      alert('⚠️ Esta boleta tiene demasiados productos distintos (' + _boletaProductos.length + ') para procesar de una vez. Divídela en 2 boletas más chicas.');
      return;
    }
    const batch = writeBatchM(dbModular);
    // Agregar por producto (mismo criterio que venta/fiado) por si el mismo producto aparece
    // dos veces en la boleta.
    const _deltasPorProducto = new Map();
    _cambiosProductos.forEach(c => {
      const actual = _deltasPorProducto.get(c.prod.id);
      if (actual) { actual.delta += c.delta; actual.costoNuevo = c.costoNuevo; if (c.venc) actual.venc = c.venc; }
      else _deltasPorProducto.set(c.prod.id, { ...c });
    });
    _deltasPorProducto.forEach(({prod, delta}) => {
      batch.set(docM(dbModular, 'productos', String(prod.id)),
        { stock: incrementM(delta) }, { merge: true });
    });

    if (!prov.boletas) prov.boletas = [];
    const _nuevaBoleta = {
      id: getId(), num, fecha,
      monto:    parseFloat(document.getElementById('bol-monto').value) || 0,
      desc:     document.getElementById('bol-desc').value,
      url:      document.getElementById('bol-url').value.trim(),
      productos: _boletaProductos.map(p => ({ prodId: p.prodId, nombre: p.nombre, cantidad: p.cantidad, esBonif: p.esBonif })),
      pagado: 0, pagos: [],
      sedeId: _sedeBoleta
    };
    batch.set(docM(dbModular, 'boletas', String(_nuevaBoleta.id)), { ..._nuevaBoleta, proveedorId: prov.id });

    _sincIniciar('boleta_lote', _nuevaBoleta.id);
    try {
      await batch.commit();
      _sincTerminar('boleta_lote', _nuevaBoleta.id);
    } catch (e) {
      _sincError('boleta_lote', _nuevaBoleta.id, e, 'la boleta — no se aplicó nada, el stock no se recibió');
      return;
    }

    _deltasPorProducto.forEach(({prod, delta, costoNuevo, venc}) => {
      prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
      prod.costo = costoNuevo;
      if (venc) prod.venc = venc;
    });
    fbGuardarProductosLote([..._deltasPorProducto.keys()]);
    prov.boletas.push(_nuevaBoleta);
    fbGuardar();
    cerrarAgregarBoleta();
    renderProveedores();
    filtrarBoletas();
    return;
  }

  // Boleta sin productos (solo registro administrativo, sin cambio de stock) — no necesita lote.
  if (!prov.boletas) prov.boletas = [];
  const _nuevaBoletaSD = {
    id: getId(), num, fecha,
    monto:    parseFloat(document.getElementById('bol-monto').value) || 0,
    desc:     document.getElementById('bol-desc').value,
    url:      document.getElementById('bol-url').value.trim(),
    productos: [],
    pagado: 0, pagos: [],
    sedeId: sedeAdminEfectiva()
  };
  prov.boletas.push(_nuevaBoletaSD);
  fbSincronizarBoleta(_nuevaBoletaSD, prov.id);
  fbGuardar();
  cerrarAgregarBoleta();
  renderProveedores();
  filtrarBoletas();
}

// ── Fase 5 arquitectura multi-sede: escritura doble en colección boletas/{id} ──
// No bloqueante, mismo criterio que fbSincronizarVenta/fbSincronizarMovimiento.
// Fiados: prioridad máxima de visibilidad — un fiado que no se guarda de verdad es
// deuda real que el negocio pierde el rastro de cobrar. Mismo mecanismo que el resto,
// pero es el caso donde más importa que la alerta llegue si el error es permanente.
function fbSincronizarMerma(merma) {
  if (!dbModular || !merma || merma.id == null) return; // [SDK modular]
  const data = { ...merma, sedeId: merma.sedeId || currentUserSedeId || 'principal' };
  _sincIniciar('merma', merma.id);
  setDocM(docM(dbModular, 'mermas', String(merma.id)), data)
    .then(() => _sincTerminar('merma', merma.id))
    .catch(e => _sincError('merma', merma.id, e, 'la merma'));
}
function fbSincronizarBoleta(boleta, proveedorId) {
  if (!dbModular || !boleta || boleta.id == null) return; // [SDK modular]
  const data = { ...boleta, proveedorId, sedeId: boleta.sedeId || currentUserSedeId || 'principal' };
  _sincIniciar('boleta', boleta.id);
  setDocM(docM(dbModular, 'boletas', String(boleta.id)), data)
    .then(() => _sincTerminar('boleta', boleta.id))
    .catch(e => _sincError('boleta', boleta.id, e, 'la boleta del proveedor'));
}

// ── Pago a proveedor (cuentas por pagar) — mismo patrón que confirmarPagoFiado, del otro lado del libro ──
async function abrirPagoBoleta(provId, idx) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede registrar pagos a proveedores.'); return; }
  const prov = DB.proveedores.find(x => x.id === provId);
  if (!prov || !prov.boletas || !prov.boletas[idx]) return;
  const b = prov.boletas[idx];
  const pendienteLocal = Math.round(((b.monto||0) - (b.pagado||0)) * 100) / 100;
  if (pendienteLocal <= 0) { alert('Esta boleta ya está pagada.'); return; }
  const monto = parseFloat(prompt(`Boleta N° ${b.num} — ${getProveedorNombre(provId)}\nPendiente: ${sol(pendienteLocal)}\n\n¿Cuánto vas a pagar?`));
  if (!monto || isNaN(monto) || monto <= 0) return;
  if (monto > pendienteLocal) { alert('El monto supera lo pendiente: ' + sol(pendienteLocal)); return; }
  const _metodosPago = ['Efectivo','Yape','Plin','QR','Link de pago','Tarjeta POS','Tarjeta POS Móvil','Transferencia'];
  const idxM = parseInt(prompt('Método de pago:\n' + _metodosPago.map((m,i)=>`${i+1}. ${m}`).join('\n'), '1'));
  const metodo = (idxM >= 1 && idxM <= _metodosPago.length) ? _metodosPago[idxM-1] : 'Efectivo';
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()

  // CRITICO: runTransaction en vez de writeBatch — mismo motivo que confirmarPagoFiado()
  // (ver clientes.js): un lote es atomico DENTRO de una sola llamada, pero no protege contra
  // 2 pagos casi simultaneos a la MISMA boleta leyendo el mismo estado viejo y pisandose
  // entre si. La transaccion lee la boleta real del servidor en el momento exacto de
  // escribir — si el saldo real ya no alcanza, se rechaza con un aviso claro en vez de
  // perder el pago anterior en silencio.
  const boletaRef = docM(dbModular, 'boletas', String(b.id));
  const sede = sedeAdminEfectiva();
  let _r;
  try {
    _r = await runTransactionM(dbModular, async (tx) => {
      const snap = await tx.get(boletaRef); // lectura garantizada real del servidor
      if (!snap.exists()) throw new Error('Esta boleta ya no existe — puede que ya se haya eliminado.'); // en modular, exists es un METODO
      const bServidor = snap.data();
      const pendienteReal = Math.max(0, Math.round(((bServidor.monto||0) - (bServidor.pagado||0)) * 100) / 100);
      if (monto > pendienteReal) {
        throw new Error('El monto (' + sol(monto) + ') supera el saldo real pendiente (' + sol(pendienteReal) + '). Alguien más pudo haber registrado un pago recién — revisa la boleta actualizada.');
      }
      const _pagoEntry = { fecha: today(), hora: nowTime(), cajero: currentUser, monto, metodo };
      const _pagadoNuevo = Math.round(((bServidor.pagado||0) + monto) * 100) / 100;

      tx.set(boletaRef, { ...bServidor, pagado: _pagadoNuevo, pagos: [...(bServidor.pagos||[]), _pagoEntry], proveedorId: provId });

      const _cajaUpdate = { egresos: incrementM(monto) };
      if (metodo === 'Efectivo') _cajaUpdate.egresosEfectivo = incrementM(monto);
      tx.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });

      const _movId = getId();
      const _movData = { id:_movId, tipo:'egreso', desc:`Pago a proveedor (${metodo}): ${getProveedorNombre(provId)} — boleta ${bServidor.num}`, monto, hora:nowTime(), fecha:today(), usuario:currentUser, sedeId: sede };
      tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

      return { _pagoEntry, _pagadoNuevo, _movData, pendienteReal };
    });
  } catch (e) {
    alert('⚠️ No se pudo registrar el pago: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se refleja en memoria local.
  if (!b.pagos) b.pagos = [];
  b.pagos.push(_r._pagoEntry);
  b.pagado = _r._pagadoNuevo;
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_r._movData);
  DB.caja.egresos = (DB.caja.egresos||0) + monto;
  if (metodo === 'Efectivo') DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + monto;

  fbGuardar();
  filtrarBoletas();
  renderProveedores();
  try { renderCaja(); } catch(e){}
  alert(`✅ Pago registrado: ${sol(monto)}. Pendiente restante: ${sol(Math.max(0,_r.pendienteReal-monto))}`);
}
