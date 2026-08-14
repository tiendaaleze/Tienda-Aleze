// ===================== PROMOCIONES =====================
function generarSugerenciasPromo() {
  const sugerencias = [];
  DB.productos.forEach(p => {
    if (p.venc && diasHasta(p.venc) <= 7 && diasHasta(p.venc) >= 0) {
      const precioSugerido = Math.max(p.costo * 1.05, p.precio * 0.8);
      sugerencias.push({ prod: p, tipo: 'vencimiento', msg: `"${p.nombre}" vence en ${diasHasta(p.venc)} días. Precio sugerido: ${sol(precioSugerido)} (costo + 5%)` });
    }
    const vendido = DB.ventas.reduce((s, v) => s + (v.items.find(i => i.prodId === p.id)?.cant || 0), 0);
    if (vendido < 2 && DB.ventas.length > 5) {
      const precioSugerido = Math.max(p.costo * 1.05, p.precio * 0.85);
      sugerencias.push({ prod: p, tipo: 'rotacion', msg: `"${p.nombre}" tiene baja rotación (${vendido} vendidos). Precio sugerido: ${sol(precioSugerido)} (descuento 15%)` });
    }
  });
  document.getElementById('promo-sugerencias').innerHTML = sugerencias.length === 0
    ? '<p style="font-size:0.85rem;color:var(--gray-600)">✅ No hay sugerencias en este momento</p>'
    : sugerencias.slice(0,4).map(s => `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--warning);margin-bottom:0.25rem">
        <span>${s.tipo==='vencimiento'?'⏰':'📉'}</span>
        <span style="font-size:0.85rem;flex:1">${s.msg}</span>
        <button class="btn btn-outline btn-xs" onclick="crearPromoSugerida(${s.prod.id})">Crear promo</button>
      </div>`).join('');
}

function crearPromoSugerida(prodId) {
  const p = DB.productos.find(x => x.id === prodId);
  document.getElementById('promo-nombre').value = 'Oferta: ' + p.nombre;
  document.getElementById('promo-precio-orig').value = p.precio;
  document.getElementById('promo-precio-promo').value = Math.max(p.costo * 1.05, p.precio * 0.8).toFixed(2);
  abrirModalPromocion();
}

// ===================== MERMAS =====================
function renderMermas() {
  // Por sede, mismo criterio que el resto de pantallas operativas.
  const _sedeM = sedeAdminEfectiva();
  const _mermasSede = DB.mermas.filter(m => (m.sedeId||'principal') === _sedeM);
  const totalPerd = _mermasSede.reduce((s, m) => s + costoMerma(m), 0);
  const mesMermas = _mermasSede.filter(m => m.fecha.startsWith(today().substring(0,7))).length;
  const motivos = {};
  _mermasSede.forEach(m => motivos[m.motivo] = (motivos[m.motivo]||0)+1);
  const topMotivo = Object.entries(motivos).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('merma-total').textContent = sol(totalPerd);
  document.getElementById('merma-mes').textContent = mesMermas;
  document.getElementById('merma-motivo').textContent = topMotivo ? topMotivo[0] : '-';

  document.getElementById('merma-tbody').innerHTML = _mermasSede.map(m => {
    const p = DB.productos.find(x => x.id === m.prodId);
    const perdida = costoMerma(m);
    return `<tr>
      <td>${formatDate(m.fecha)}</td>
      <td>${p ? p.nombre : '<span style="color:var(--gray-400)">Producto eliminado</span>'}</td>
      <td>${m.cant} ${p?p.unidad:''}</td>
      <td><span class="badge badge-orange">${m.motivo}</span></td>
      <td style="color:var(--danger);font-weight:700">${sol(perdida)}</td>
      <td>${m.usuario}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-xs" onclick="editarMerma(${m.id})">✏️ Editar</button>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarMerma(${m.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin mermas registradas</td></tr>';
}

function abrirModalMerma() {
  editingMermaId = null;
  const sel = document.getElementById('merma-prod');
  sel.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre} (Stock: ${stockEnSede(p)} ${p.unidad})</option>`).join('');
  document.getElementById('merma-cant').value = '';
  document.getElementById('merma-obs').value = '';
  abrirModal('modal-merma');
}

let editingMermaId = null;
function editarMerma(id) {
  const m = DB.mermas.find(x => x.id === id);
  editingMermaId = id;
  const sel = document.getElementById('merma-prod');
  sel.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre} (Stock: ${stockEnSede(p)} ${p.unidad})</option>`).join('');
  sel.value = m.prodId;
  document.getElementById('merma-cant').value = m.cant;
  document.getElementById('merma-motivo-sel').value = m.motivo;
  document.getElementById('merma-obs').value = m.obs || '';
  abrirModal('modal-merma');
}

async function guardarMerma() {
  // Vendedor puede crear/editar mermas de su propia sede sin depender de admin — una botella
  // rota o un vencimiento no debería esperar aprobación. Solo eliminar sigue siendo de admin.
  const _sede = sedeAdminEfectiva();
  const prodId = parseInt(document.getElementById('merma-prod').value);
  const cant = parseFloat(document.getElementById('merma-cant').value) || 0;
  const motivo = document.getElementById('merma-motivo-sel').value;
  const obs = document.getElementById('merma-obs').value;
  const prod = DB.productos.find(p => p.id === prodId);
if (!prod) { alert('Producto no encontrado. Recarga el inventario.'); return; }
  if (!cant || cant <= 0) { alert('Ingresa una cantidad válida'); return; }

  // Paquete atomico: el descuento de stock y el registro de la merma viajan juntos — sin esto,
  // el stock podia descontarse sin que la merma quedara registrada (perdida sin motivo ni
  // rastro), o la merma quedar registrada sin el descuento real (inventario desincronizado).
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

if (editingMermaId) {
    // CRITICO: runTransaction en vez de writeBatch — lee la merma vieja real del servidor
    // antes de calcular cuanto stock restaurar y cuanto descontar de nuevo, para no calcular
    // mal si 2 ediciones casi simultaneas tocan la misma merma.
    const mermaRef = docM(dbModular, 'mermas', String(editingMermaId));
    let _r;
    try {
      _r = await runTransactionM(dbModular, async (tx) => {
        const snap = await tx.get(mermaRef); // lectura garantizada real del servidor
        if (!snap.exists()) throw new Error('Esta merma ya no existe — puede que ya se haya eliminado.'); // en modular, exists es un METODO
        const oldServidor = snap.data();
        const oldProd = DB.productos.find(p => p.id === oldServidor.prodId);
        const oldCant = oldServidor.cant;
        const stockSimulado = stockEnSede(prod) + (oldProd && oldProd.id === prod.id ? oldCant : 0);
        if (cant > stockSimulado) throw new Error('La cantidad supera el stock disponible en esa sede.');

        const _deltasPorProducto = new Map();
        const _acumular = (p, delta) => {
          const actual = _deltasPorProducto.get(p.id);
          if (actual) actual.delta += delta; else _deltasPorProducto.set(p.id, { prod: p, delta });
        };
        if (oldProd) _acumular(oldProd, oldCant); // restaurar stock viejo
        _acumular(prod, -cant); // aplicar el nuevo descuento
        const _deltasStock = [];
        _deltasPorProducto.forEach(({prod: p, delta}) => {
          tx.set(docM(dbModular, 'productos', String(p.id)), { stock: incrementM(delta) }, { merge: true });
          _deltasStock.push({ prod: p, delta });
        });

        tx.set(mermaRef, { prodId, cant, motivo, obs, sedeId: _sede, costoUnitario: prod.costo }, { merge: true });
        return { _deltasStock };
      });
    } catch (e) {
      alert('⚠️ No se pudo guardar la merma editada: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
      return;
    }

    const old = DB.mermas.find(x => x.id === editingMermaId);
    _r._deltasStock.forEach(({prod: p, delta}) => {
      p.stock = Math.max(0, Math.round(((p.stock||0)+delta)*1000)/1000);
    });
    if (old) { old.prodId = prodId; old.cant = cant; old.motivo = motivo; old.obs = obs; old.sedeId = _sede; old.costoUnitario = prod.costo; }
    fbGuardar();
  } else {
    if (cant > stockEnSede(prod)) { alert('La cantidad supera el stock disponible'); return; }
    const nuevaMerma = { id: getId(), prodId, cant, motivo, obs, fecha: today(), usuario: currentUser, sedeId: _sede, costoUnitario: prod.costo };
    const batch = writeBatchM(dbModular);
    batch.set(docM(dbModular, 'productos', String(prod.id)),
      { stock: incrementM(-cant) }, { merge: true });
    batch.set(docM(dbModular, 'mermas', String(nuevaMerma.id)), nuevaMerma);

    _sincIniciar('merma_lote', nuevaMerma.id);
    try {
      await batch.commit();
      _sincTerminar('merma_lote', nuevaMerma.id);
    } catch (e) {
      _sincError('merma_lote', nuevaMerma.id, e, 'la merma — no se aplicó nada');
      return;
    }
    prod.stock = Math.max(0, Math.round(((prod.stock||0)-cant)*1000)/1000);
    DB.mermas.push(nuevaMerma);
    fbGuardar();
  }
  cerrarModal('modal-merma');
  renderMermas();
  updateAlertCount();
  try { renderDashboard(); } catch(e){}
  try { renderCaja(); } catch(e){}
  try { generarReporte(); } catch(e){}
  renderInvTable();
}
let _mermaElimId = null;

function eliminarMerma(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar mermas. Puedes crear y editar, pero no borrar lo ya registrado.'); return; }
  const m = DB.mermas.find(x => x.id === id);
  if (!m) return;
  _mermaElimId = id;
  const prod = DB.productos.find(p => p.id === m.prodId);
  const nomProd = prod ? prod.nombre : 'producto eliminado';
  document.getElementById('merma-elim-desc').textContent =
    '¿Eliminar el registro de merma de "' + nomProd + '" (' + m.cant + ' ' + (prod ? prod.unidad : 'und') + ')? Selecciona qué hacer con el stock:';
  document.querySelectorAll('input[name="merma-elim-opcion"]').forEach(r => r.checked = false);
  abrirModal('modal-confirmar-eliminar-merma');
}
async function _confirmarElimMerma() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar mermas.'); return; }
  const opcion = document.querySelector('input[name="merma-elim-opcion"]:checked');
  if (!opcion) { alert('Selecciona una opción antes de continuar.'); return; }
  const m = DB.mermas.find(x => x.id === _mermaElimId);
  if (!m) { cerrarModal('modal-confirmar-eliminar-merma'); return; }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  const _restaurar = opcion.value === 'restaurar';
  const prod = _restaurar ? DB.productos.find(p => p.id === m.prodId) : null;

  // Paquete atomico: restaurar stock (si aplica) y borrar la merma viajan juntos.
  const batch = writeBatchM(dbModular);
  if (_restaurar && prod) {
    batch.set(docM(dbModular, 'productos', String(prod.id)),
      { stock: incrementM(m.cant) }, { merge: true });
  }
  batch.delete(docM(dbModular, 'mermas', String(_mermaElimId)));

  _sincIniciar('elim_merma_lote', _mermaElimId);
  try {
    await batch.commit();
    _sincTerminar('elim_merma_lote', _mermaElimId);
  } catch (e) {
    _sincError('elim_merma_lote', _mermaElimId, e, 'la eliminación de la merma — no se aplicó nada');
    return;
  }

  if (_restaurar && prod) {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+m.cant)*1000)/1000);
  }
  DB.mermas = DB.mermas.filter(x => x.id !== _mermaElimId);
  _mermaElimId = null;
  fbGuardar();
  cerrarModal('modal-confirmar-eliminar-merma');
  renderMermas();
  renderInvTable();
  try { renderDashboard(); } catch(e){}
  try { generarReporte(); } catch(e){}
}
// ===================== PROMOCIONES con editar =====================
let editingPromoId = null;

function renderPromociones() {
  generarSugerenciasPromo();
  document.getElementById('promo-tbody').innerHTML = DB.promociones.map(p => `<tr>
    <td><strong>${p.nombre}</strong>${p.sedeId ? `<div style="font-size:.68rem;color:var(--warning);font-weight:600">📍 Solo ${p.sedeId}</div>` : ''}</td>
    <td><span class="badge badge-${p.tipo==='combo'?'blue':'purple'}">${p.tipo}</span></td>
    <td style="font-size:0.8rem">${p.prod1nombre||''}${p.prod2nombre?' + '+p.prod2nombre:''}</td>
    <td>${(p.tipo==='2x1'||p.tipo==='3x2') ? '—' : sol(p.precioOrig)}</td>
    <td style="color:var(--accent);font-weight:700">${(p.tipo==='2x1'||p.tipo==='3x2') ? `Compra ${p.cantidadRequerida} paga ${p.cantidadAPagar}` : sol(p.precioPromo)}</td>
    <td style="font-size:0.8rem">${formatDate(p.desde)} - ${formatDate(p.hasta)}</td>
    <td><span class="badge badge-${p.activa && p.hasta>=today()?'green':'gray'}">${p.activa && p.hasta>=today()?'Activa':'Inactiva'}</span></td>
    <td style="white-space:nowrap">
      <button class="btn btn-outline btn-xs" onclick="editarPromocion(${p.id})">✏️ Editar</button>
      <button class="btn btn-xs btn-outline" onclick="togglePromo(${p.id})">${p.activa?'⏸️':'▶️'}</button>
      <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarPromo(${p.id})">🗑️</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin promociones</td></tr>';
}

function _llenarSelectsPromo() {
  const prods = DB.productos.filter(p => !p.esCombo);
  ['promo-prod1','promo-prod2','promo-prod3'].forEach((selId, idx) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = (idx > 0 ? `<option value="">— Sin producto ${idx+1} —</option>` : '') +
      prods.map(p => `<option value="${p.id}">${p.nombre} (${sol(p.precio)})</option>`).join('');
  });
}

// Buscador seleccionable para los 3 campos de producto — mismo patron que el buscador de
// cliente en POS. El select oculto (mismo id de siempre) sigue siendo la fuente real que lee
// guardarPromocion()/calcPromo()/etc, esto solo agrega una forma mas facil de establecer su
// valor sin tener que recorrer una lista larga.
function _promoProdBuscar(n) {
  const q = (document.getElementById('promo-prod'+n+'-buscar')?.value || '').trim();
  const sug = document.getElementById('promo-prod'+n+'-sugerencias');
  if (!sug) return;
  const prods = DB.productos.filter(p => !p.esCombo);
  const matches = (q ? prods.filter(p => _norm(p.nombre).includes(_norm(q))) : prods).slice(0, 8);
  if (!matches.length) {
    sug.innerHTML = `<div style="padding:.5rem;color:var(--gray-400)">Sin resultados</div>`;
  } else {
    sug.innerHTML = matches.map(p => `<div onclick="_promoProdSeleccionar(${n}, ${p.id})" style="padding:.4rem .6rem;cursor:pointer;border-bottom:1px solid var(--gray-100)" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        ${p.nombre} <span style="color:var(--gray-400);font-size:.75rem">(${sol(p.precio)})</span>
       </div>`).join('');
  }
  sug.style.display = 'block';
}
function _promoProdSeleccionar(n, id) {
  const p = DB.productos.find(x => x.id === id);
  const sel = document.getElementById('promo-prod'+n);
  const buscar = document.getElementById('promo-prod'+n+'-buscar');
  if (sel) sel.value = id;
  if (buscar) buscar.value = p ? p.nombre : '';
  const sug = document.getElementById('promo-prod'+n+'-sugerencias'); if (sug) sug.style.display = 'none';
  onPromoProductoChange();
}
// Limpia el campo visible de busqueda de un producto (sin tocar el select oculto, eso lo hace
// quien llame a esto por separado) — usado al abrir el modal nuevo y al cambiar de tipo.
function _resetPromoProdBuscador(n) {
  const buscar = document.getElementById('promo-prod'+n+'-buscar');
  if (buscar) buscar.value = '';
}

function onPromoProductoChange() {
  const ids = ['promo-prod1','promo-prod2','promo-prod3']
    .map(id => parseInt(document.getElementById(id)?.value) || null);
  const prods = ids.map(id => id ? DB.productos.find(p => p.id === id) : null);
  const nombreActual = document.getElementById('promo-nombre').value;
  const nombreSugerido = 'Promo ' + prods.filter(Boolean).map(p => p.nombre).join(' + ');
  if (!nombreActual || nombreActual.startsWith('Promo ')) {
    document.getElementById('promo-nombre').value = nombreSugerido;
  }
  calcPromo();
}

// Muestra/oculta los campos del formulario segun el tipo de promocion elegido — evita la
// confusion real que ya paso: seleccionar 2-3 productos sin haber cambiado el tipo a "Pack"
// (que se queda en "Descuento directo" por defecto) guardaba la promocion sin crear nunca el
// producto combo, aunque el nombre sugiriera que involucraba varios productos.
function actualizarVisibilidadTipoPromo() {
  const tipo = document.getElementById('promo-tipo-sel').value;
  const esPack = tipo === 'pack';
  const esCantidad = tipo === '2x1' || tipo === '3x2';
  document.getElementById('promo-prod2-wrap').style.display = esPack ? 'block' : 'none';
  document.getElementById('promo-prod3-wrap').style.display = esPack ? 'block' : 'none';
  document.getElementById('promo-margen-wrap').style.display = esCantidad ? 'none' : 'block';
  document.getElementById('promo-precioofer-wrap').style.display = esCantidad ? 'none' : 'block';
  document.getElementById('promo-preciorig-wrap').style.display = esCantidad ? 'none' : 'block';
  document.getElementById('promo-cantidad-wrap').style.display = esCantidad ? 'block' : 'none';
  // Limpia campos ocultos — evita que queden seleccionados pero invisibles y se guarden igual.
  if (!esPack) {
    document.getElementById('promo-prod2').value = '';
    document.getElementById('promo-prod3').value = '';
    _resetPromoProdBuscador(2);
    _resetPromoProdBuscador(3);
  }
  const _ayudaMax = document.getElementById('promo-max-venta-ayuda');
  if (_ayudaMax) {
    _ayudaMax.textContent = esPack
      ? 'Al llegar a este máximo de packs en una misma venta, no se puede agregar más — se avisa al cajero/cliente.'
      : 'Al llegar a este máximo en una misma venta, las unidades adicionales se cobran al precio normal (sin el descuento).';
  }
  calcPromo();
}

function calcPromo() {
  const tipo = document.getElementById('promo-tipo-sel').value;
  const prod1Id = parseInt(document.getElementById('promo-prod1').value) || null;
  const prod1 = prod1Id ? DB.productos.find(p => p.id === prod1Id) : null;
  if (tipo === '2x1' || tipo === '3x2') {
    if (!prod1) {
      document.getElementById('promo-cantidad-detalle').textContent = 'Selecciona el producto';
      return;
    }
    const [_req, _pag] = tipo === '2x1' ? [2, 1] : [3, 2];
    document.getElementById('promo-cantidad-detalle').innerHTML =
      `<div>Por cada <strong>${_req} unidades</strong> de "${prod1.nombre}" que el cliente lleve, paga solo <strong>${_pag}</strong> — la diferencia (${_req-_pag} unidad${_req-_pag>1?'es':''}) es gratis.</div>
       <div style="margin-top:.4rem;color:var(--gray-500)">Precio de venta normal: ${sol(prod1.precio)} — se sigue vendiendo a ese precio, el descuento se aplica solo al alcanzar la cantidad completa.</div>`;
    return;
  }
  const ids = ['promo-prod1','promo-prod2','promo-prod3']
    .map(id => parseInt(document.getElementById(id)?.value) || null);
  const prods = ids.map(id => id ? DB.productos.find(p => p.id === id) : null).filter(Boolean);
  if (!prods.length) {
    document.getElementById('promo-calc-detalle').textContent = 'Selecciona al menos un producto';
    return;
  }
  const margen = parseFloat(document.getElementById('promo-margen-num').value) || 0;
  const costoTotal = prods.reduce((s, p) => s + p.costo, 0);
  const precioOrig = prods.reduce((s, p) => s + p.precio, 0);
  const precioSugerido = Math.ceil(costoTotal * (1 + margen / 100) * 10) / 10;
  const ahorro = precioOrig - precioSugerido;
  document.getElementById('promo-precio-orig').value = precioOrig.toFixed(2);
  document.getElementById('promo-precio-promo').value = precioSugerido.toFixed(2);
  document.getElementById('promo-calc-detalle').innerHTML =
    prods.map(p => `<div style="display:flex;justify-content:space-between"><span>${p.nombre} x1:</span><span>Costo ${sol(p.costo)} / Venta ${sol(p.precio)}</span></div>`).join('') +
    `<div style="border-top:1px solid var(--gray-200);margin-top:.3rem;padding-top:.3rem">
      <div style="display:flex;justify-content:space-between"><span>Costo total:</span><strong>${sol(costoTotal)}</strong></div>
      <div style="display:flex;justify-content:space-between"><span>Precio sumado:</span><span style="text-decoration:line-through;color:var(--gray-400)">${sol(precioOrig)}</span></div>
      <div style="display:flex;justify-content:space-between"><span>Precio oferta (${margen}% margen):</span><strong style="color:var(--accent)">${sol(precioSugerido)}</strong></div>
      <div style="display:flex;justify-content:space-between"><span>Ahorro cliente:</span><strong style="color:var(--primary)">${sol(ahorro > 0 ? ahorro : 0)}</strong></div>
    </div>`;
  document.getElementById('promo-aviso').textContent = precioSugerido < costoTotal ? '⚠️ Precio por debajo del costo' : '';
}

function calcPromoDesdeManual() {
  const ids = ['promo-prod1','promo-prod2','promo-prod3']
    .map(id => parseInt(document.getElementById(id)?.value) || null);
  const prods = ids.map(id => id ? DB.productos.find(p => p.id === id) : null).filter(Boolean);
  const costoTotal = prods.reduce((s, p) => s + p.costo, 0);
  const precioPromo = parseFloat(document.getElementById('promo-precio-promo').value) || 0;
  if (costoTotal > 0) {
    const margenReal = Math.round((precioPromo / costoTotal - 1) * 100);
    document.getElementById('promo-margen-num').value = margenReal;
    document.getElementById('promo-margen-slider').value = Math.max(0, margenReal);
  }
}

function onPromoImgSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      // CRITICO: esta imagen nunca subia a Storage — quedaba como base64 directo dentro del
      // propio documento de la promocion en Firestore, la unica de las 4 subidas de imagen
      // del sistema que hacia esto. Ahora sube a Storage igual que producto/categoria/fotos
      // extra, consistente con el resto — y de paso, sin recorte forzado (preserva
      // proporcion). 200px es de sobra para esta miniatura, que nunca se ve mas grande.
      const ratioPromo = Math.min(200 / img.width, 200 / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratioPromo);
      canvas.height = Math.round(img.height * ratioPromo);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const previewData = canvas.toDataURL('image/webp', 0.78);
      const preview = document.getElementById('promo-img-preview');
      if (preview) preview.innerHTML = `<img src="${previewData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
      if (!storageModular) {
        document.getElementById('promo-img-data').value = previewData;
        return;
      }
      if (preview) preview.insertAdjacentHTML('afterend', '<span id="_promo-img-upload-lbl" style="font-size:.72rem;color:var(--primary)">⏳ Subiendo...</span>');
      canvas.toBlob(async (blob) => {
        try {
          const fileName = `promociones/${editingPromoId || Date.now()}.webp`;
          const ref = refM(storageModular, fileName);
          await uploadBytesM(ref, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=2592000' });
          const url = await getDownloadURLM(ref);
          document.getElementById('promo-img-data').value = url;
          const lbl = document.getElementById('_promo-img-upload-lbl');
          if (lbl) lbl.remove();
        } catch(err) {
          document.getElementById('promo-img-data').value = previewData;
          const lbl = document.getElementById('_promo-img-upload-lbl');
          if (lbl) lbl.textContent = '⚠️ Error Storage — imagen guardada local';
        }
      }, 'image/webp', 0.78);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function limpiarImgPromo() {
  document.getElementById('promo-img-data').value = '';
  document.getElementById('promo-img-file').value = '';
  const preview = document.getElementById('promo-img-preview');
  if (preview) { preview.innerHTML = '🏷️'; preview.style.fontSize = '1.8rem'; }
}

function imprimirQrPromo() {
  const el = document.getElementById('promo-qr-preview');
  const canvas = el ? el.querySelector('canvas') : null;
  const nombre = document.getElementById('promo-nombre').value || 'Promo';
  if (!canvas) { alert('Genera el QR primero guardando la promoción'); return; }
  const imgSrc = canvas.toDataURL('image/png');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>QR ${nombre}</title>
    <style>body{text-align:center;padding:20px;font-family:Arial} @media print{button{display:none}}</style>
    </head><body><h3>${nombre}</h3>
    <img src="${imgSrc}" style="width:200px;height:200px"/>
    <br><br><button onclick="window.print()">🖨️ Imprimir</button>
    <button onclick="window.close()" style="margin-left:8px">✕ Cerrar</button>
    </body></html>`);
  win.document.close();
}

function editarPromocion(id) {
  editingPromoId = id;
  const pr = DB.promociones.find(x => x.id === id);
  document.getElementById('promo-modal-titulo').textContent = '✏️ Editar Promoción';
  _llenarSelectsPromo();
  document.getElementById('promo-nombre').value = pr.nombre;
  document.getElementById('promo-tipo-sel').value = pr.tipo;
  document.getElementById('promo-prod1').value = pr.prod1 || '';
  document.getElementById('promo-prod2').value = pr.prod2 || '';
  document.getElementById('promo-prod3').value = pr.prod3 || '';
  document.getElementById('promo-prod1-buscar').value = pr.prod1nombre || '';
  document.getElementById('promo-prod2-buscar').value = pr.prod2nombre || '';
  document.getElementById('promo-prod3-buscar').value = pr.prod3nombre || '';
  document.getElementById('promo-desde').value = pr.desde;
  document.getElementById('promo-hasta').value = pr.hasta;
  document.getElementById('promo-limite').value = pr.limite || 100;
  document.getElementById('promo-max-venta').value = pr.maxPorVenta || '';
  const margen = pr.precioOrig > 0 ? Math.round((pr.precioPromo/pr.precioOrig-1)*100) : 20;
  document.getElementById('promo-margen-num').value = Math.max(0, margen);
  document.getElementById('promo-margen-slider').value = Math.max(0, margen);
  document.getElementById('promo-aviso').textContent = '';
  actualizarVisibilidadTipoPromo();
  document.getElementById('promo-precio-promo').value = pr.precioPromo;
  const imgData = pr.imagen || '';
  document.getElementById('promo-img-data').value = imgData;
  const preview = document.getElementById('promo-img-preview');
  if (imgData && preview) {
    preview.innerHTML = `<img src="${imgData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
  }
  if (pr.packProdId) {
    document.getElementById('promo-qr-wrap').style.display = 'block';
    document.getElementById('promo-qr-label').textContent = pr.nombre;
    const el = document.getElementById('promo-qr-preview');
    if (el) { el.innerHTML = ''; new QRCode(el, {text: pr.packCodigo||pr.packProdId.toString(), width:120, height:120}); }
  } else {
    document.getElementById('promo-qr-wrap').style.display = 'none';
  }
  abrirModal('modal-promocion');
}

function abrirModalPromocion() {
  editingPromoId = null;
  document.getElementById('promo-modal-titulo').textContent = '🏷️ Nueva Promoción / Combo';
  _llenarSelectsPromo();
  _resetPromoProdBuscador(2);
  _resetPromoProdBuscador(3);
  // Producto 1 no tiene opcion vacia — siempre queda el primero de la lista seleccionado por
  // defecto (comportamiento previo a este cambio) — se sincroniza el campo visible con ese
  // mismo valor real, para no mostrar el buscador vacio mientras el select oculto ya tiene algo.
  const _prod1Sel = document.getElementById('promo-prod1');
  const _prod1DefaultId = _prod1Sel ? parseInt(_prod1Sel.value) : null;
  const _prod1Default = _prod1DefaultId ? DB.productos.find(p => p.id === _prod1DefaultId) : null;
  document.getElementById('promo-prod1-buscar').value = _prod1Default ? _prod1Default.nombre : '';
  const hoy = today();
  const en7 = new Date(); en7.setDate(en7.getDate()+7);
  document.getElementById('promo-desde').value = hoy;
  document.getElementById('promo-hasta').value = en7.toISOString().split('T')[0];
  document.getElementById('promo-nombre').value = '';
  document.getElementById('promo-tipo-sel').value = 'descuento';
  document.getElementById('promo-margen-num').value = 20;
  document.getElementById('promo-margen-slider').value = 20;
  document.getElementById('promo-precio-orig').value = '';
  document.getElementById('promo-precio-promo').value = '';
  document.getElementById('promo-calc-detalle').textContent = 'Selecciona al menos un producto';
  document.getElementById('promo-aviso').textContent = '';
  document.getElementById('promo-limite').value = 100;
  document.getElementById('promo-max-venta').value = '';
  document.getElementById('promo-img-data').value = '';
  document.getElementById('promo-img-file').value = '';
  actualizarVisibilidadTipoPromo();
  const preview = document.getElementById('promo-img-preview');
  if (preview) { preview.innerHTML = '🏷️'; preview.style.fontSize = '1.8rem'; }
  document.getElementById('promo-qr-wrap').style.display = 'none';
  abrirModal('modal-promocion');
}

function guardarPromocion() {
  const nombre = document.getElementById('promo-nombre').value.trim();
  const prod1Id = parseInt(document.getElementById('promo-prod1').value) || null;
  const prod2Id = parseInt(document.getElementById('promo-prod2').value) || null;
  const prod3Id = parseInt(document.getElementById('promo-prod3').value) || null;
  const prod1 = prod1Id ? DB.productos.find(p => p.id === prod1Id) : null;
  const prod2 = prod2Id ? DB.productos.find(p => p.id === prod2Id) : null;
  const prod3 = prod3Id ? DB.productos.find(p => p.id === prod3Id) : null;
  const precioOrig = parseFloat(document.getElementById('promo-precio-orig').value) || 0;
  const precioPromo = parseFloat(document.getElementById('promo-precio-promo').value) || 0;
  const limite = parseInt(document.getElementById('promo-limite').value) || 0;
  const maxPorVenta = parseInt(document.getElementById('promo-max-venta').value) || 0; // 0 = sin límite
  const imagen = document.getElementById('promo-img-data').value || '';
  const tipo = document.getElementById('promo-tipo-sel').value;
  const esCantidad = tipo === '2x1' || tipo === '3x2';
  if (!nombre || !prod1Id) { alert('Completa nombre y producto 1'); return; }
  const costoTotal = (prod1?.costo||0) + (prod2?.costo||0) + (prod3?.costo||0);
  if (!esCantidad && precioPromo < costoTotal && !confirm('El precio oferta está por debajo del costo. ¿Continuar?')) return;
  // Cantidades explicitas para 2x1/3x2 (compra N, paga M) — mas robusto que interpretar el
  // texto "2x1"/"3x2" cada vez que se necesite calcular un descuento.
  const cantidadRequerida = tipo === '2x1' ? 2 : (tipo === '3x2' ? 3 : null);
  const cantidadAPagar    = tipo === '2x1' ? 1 : (tipo === '3x2' ? 2 : null);
  const espack = tipo === 'pack' && (prod2Id || prod3Id);
  let packProdId = editingPromoId ? (DB.promociones.find(x=>x.id===editingPromoId)?.packProdId || null) : null;
  let packCodigo = editingPromoId ? (DB.promociones.find(x=>x.id===editingPromoId)?.packCodigo || null) : null;
  if (espack && !packProdId) {
    let catPromo = DB.categorias.find(c => c.nombre === 'Promociones');
    if (!catPromo) {
      catPromo = { id: getId(), nombre: 'Promociones', emoji: '🏷️', margen: 0, imagen: '' };
      DB.categorias.unshift(catPromo);
    }
    packProdId = getId();
    packCodigo = 'PROMO-' + packProdId;
    const componentes = [
      { prodId: prod1Id, cant: 1 },
      ...(prod2Id ? [{ prodId: prod2Id, cant: 1 }] : []),
      ...(prod3Id ? [{ prodId: prod3Id, cant: 1 }] : [])
    ];
    DB.productos.push({
      id: packProdId, nombre, cat: catPromo.id,
      tipo: 'combo', unidad: 'und',
      costo: costoTotal, precio: precioPromo,
      stock: 999, stockMin: 0, venc: '',
      codigo: packCodigo, prov: null,
      esCombo: true, componentes, imagen, promoActiva: true
    });
    // Bug real encontrado: este flag se ponía en true y NUNCA se apagaba — cualquier intento
    // de "Salir" después de crear un combo/pack quedaba trabado en silencio, reintentando cada
    // 200ms para siempre (doLogout espera a que este flag baje antes de cerrar sesión).
    _fbEscribiendo = true;
    fbGuardarProducto(packProdId);
    setTimeout(() => { _fbEscribiendo = false; }, 300);
    document.getElementById('promo-qr-wrap').style.display = 'block';
    document.getElementById('promo-qr-label').textContent = nombre;
    const el = document.getElementById('promo-qr-preview');
    if (el) { el.innerHTML = ''; new QRCode(el, { text: packCodigo, width: 120, height: 120 }); }
  } else if (espack && packProdId) {
    const componentesPack = [
      { prodId: prod1Id, cant: 1 },
      ...(prod2Id ? [{ prodId: prod2Id, cant: 1 }] : []),
      ...(prod3Id ? [{ prodId: prod3Id, cant: 1 }] : [])
    ];
    const prodPack = DB.productos.find(p => p.id === packProdId);
    if (prodPack) {
      prodPack.nombre = nombre;
      prodPack.precio = precioPromo;
      prodPack.costo = costoTotal;
      prodPack.imagen = imagen;
      prodPack.componentes = componentesPack;
      fbGuardarProducto(packProdId);
    } else {
      // CRITICO: red de seguridad — el producto combo original se perdio (nunca llego a
      // escribirse en el servidor, o se perdio en una sobrescritura concurrente del documento
      // db_productos completo). Sin esto, editar y guardar la promocion no hacia
      // absolutamente nada para recuperarlo — el combo quedaba invisible en POS para siempre,
      // aunque la promocion en si siguiera existiendo y mostrando su QR con normalidad. Se
      // recrea desde cero, misma logica que la creacion original de mas arriba.
      let catPromo = DB.categorias.find(c => c.nombre === 'Promociones');
      if (!catPromo) {
        catPromo = { id: getId(), nombre: 'Promociones', emoji: '🏷️', margen: 0, imagen: '' };
        DB.categorias.unshift(catPromo);
      }
      DB.productos.push({
        id: packProdId, nombre, cat: catPromo.id,
        tipo: 'combo', unidad: 'und',
        costo: costoTotal, precio: precioPromo,
        stock: 999, stockMin: 0, venc: '',
        codigo: packCodigo || ('PROMO-' + packProdId), prov: null,
        esCombo: true, componentes: componentesPack, imagen, promoActiva: true
      });
      _fbEscribiendo = true;
      fbGuardarProducto(packProdId);
      setTimeout(() => { _fbEscribiendo = false; }, 300);
    }
  }
  // CRITICO: vendidos NUNCA debe tocarse al editar una promocion existente — antes se leia de
  // memoria local y se re-escribia, lo que perdia el incremento de una venta concurrente con
  // esa misma promocion justo mientras se guardaba la edicion (mismo tipo de bug ya corregido
  // en fiados/boletas/ventas). Ahora directamente se EXCLUYE del payload al editar, con
  // merge:true — el campo nunca se toca en absoluto, queda siempre con su valor real del
  // servidor. Solo se inicializa explicitamente en 0 al crear una promocion nueva, donde el
  // documento no existe todavia y necesita algun valor inicial.
  const data = {
    nombre, tipo,
    prod1: prod1Id, prod1nombre: prod1?.nombre || null,
    prod2: prod2Id, prod2nombre: prod2?.nombre || null,
    prod3: prod3Id, prod3nombre: prod3?.nombre || null,
    precioOrig, precioPromo,
    cantidadRequerida, cantidadAPagar,
    desde: document.getElementById('promo-desde').value,
    hasta: document.getElementById('promo-hasta').value,
    activa: true, limite, maxPorVenta,
    imagen, packProdId, packCodigo
  };
  // CRITICO: promociones ahora tiene su propia coleccion (mismo criterio que ventas,
  // clientes, etc.) — ya no depende de guardarse como parte de aleze/db via fbGuardar().
  let _promoFinal, _payloadEscritura;
  if (editingPromoId) {
    const idx = DB.promociones.findIndex(x => x.id === editingPromoId);
    if (idx >= 0) DB.promociones[idx] = { ...DB.promociones[idx], ...data };
    _promoFinal = DB.promociones[idx];
    _payloadEscritura = data; // sin vendidos — nunca se toca al editar
  } else {
    _promoFinal = { id: getId(), ...data, vendidos: 0 };
    DB.promociones.push(_promoFinal);
    _payloadEscritura = { ...data, vendidos: 0 }; // se inicializa explicitamente al crear
  }
  if (dbModular) setDocM(docM(dbModular, 'promociones', String(_promoFinal.id)), _payloadEscritura, { merge: true }).catch(e => console.warn('No se pudo guardar promociones/'+_promoFinal.id, e)); // [SDK modular]
  cerrarModal('modal-promocion');
  renderPromociones();
  try { renderPosGrid(); } catch(e) {}
  try { renderMobPosGrid(); } catch(e) {}
}

function togglePromo(id) {
  const p = DB.promociones.find(x => x.id === id);
  if (!p) return;
  p.activa = !p.activa;
  if (p.packProdId) {
    const prodPack = DB.productos.find(x => x.id === p.packProdId);
    if (prodPack) { prodPack.promoActiva = p.activa; fbGuardarProducto(p.packProdId); }
  }
  if (dbModular) setDocM(docM(dbModular, 'promociones', String(id)), { activa: p.activa }, { merge: true }).catch(e => console.warn('No se pudo actualizar promociones/'+id, e)); // [SDK modular]
  renderPromociones();
  try { renderPosGrid(); } catch(e){}
  try { renderMobPosGrid(); } catch(e){}
}
function eliminarPromo(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar promociones.'); return; }
  if (!confirm('¿Eliminar?')) return;
  const p = DB.promociones.find(x => x.id === id);
  if (p && p.packProdId) {
    DB.productos = DB.productos.filter(x => x.id !== p.packProdId);
    fbGuardarProducto(p.packProdId);
  }
  DB.promociones = DB.promociones.filter(x => x.id !== id);
  if (dbModular) deleteDocM(docM(dbModular, 'promociones', String(id))).catch(e => console.warn('No se pudo borrar promociones/'+id, e));
  renderPromociones();
}

// Interceptar addToCart para combos
const _addToCartOrig = addToCart;
window.addToCart = function(prodId) {
  const prod = DB.productos.find(p=>p.id===prodId);
  if (prod&&prod.esCombo&&prod.componentes) {
    for (const comp of prod.componentes) {
      const cp=DB.productos.find(x=>x.id===comp.prodId);
      if (!cp||stockEnSede(cp)<comp.cant) { alert(`Stock insuficiente de "${cp?.nombre||'componente'}" para armar el combo`); return; }
    }
  }
  _addToCartOrig(prodId);
};

// Premio en POS visible sin interrumpir — ahora muestra directamente cuánto dinero tiene
// acumulado el cliente en puntos, sin pasar por umbrales de premios discretos.
function actualizarPremioAlertPOS() {
  const cliId = parseInt(document.getElementById('pos-cliente').value)||null;
  const alertDiv = document.getElementById('pos-premio-alert');
  const alertTxt = document.getElementById('pos-premio-txt');
  const btnCanjear = document.getElementById('pos-premio-btn-canjear');
  if (!cliId||!alertDiv) { if(alertDiv) alertDiv.style.display='none'; return; }
  const est = estadoFidelizacion(cliId);
  if (est.valorCanjeable > 0) {
    alertDiv.style.display='block';
    alertDiv.style.background = 'var(--accent-light)';
    alertTxt.textContent = `🎉 ${getClienteNombre(cliId)} tiene ${est.saldo} pts — canjeable por ${sol(est.valorCanjeable)}`;
    if (btnCanjear) btnCanjear.style.display = 'inline-block';
  } else {
    alertDiv.style.display='none';
    if (btnCanjear) btnCanjear.style.display = 'none';
  }
}

// ── Modal de canje: el cajero ingresa cuántos puntos canjear (hasta el saldo disponible),
// con el equivalente en soles calculado al instante — reemplaza la lista de premios
// preconfigurados del sistema anterior.
function abrirModalCanje() {
  const cliId = parseInt(document.getElementById('pos-cliente').value) || null;
  if (!cliId) return;
  const est = estadoFidelizacion(cliId);
  if (est.saldo <= 0) { alert('Este cliente todavía no tiene puntos acumulados.'); return; }
  document.getElementById('modal-canje-cliente').textContent = `${getClienteNombre(cliId)} — saldo: ${est.saldo} puntos (equivale a ${sol(est.valorCanjeable)})`;
  const inp = document.getElementById('canje-puntos-input');
  inp.value = est.saldo;
  inp.max = est.saldo;
  inp.dataset.clienteId = cliId;
  _actualizarPreviewCanje();
  abrirModal('modal-canje');
}

// Recalcula el "= S/X" en vivo mientras el cajero tipea la cantidad de puntos a canjear.
function _actualizarPreviewCanje() {
  const inp = document.getElementById('canje-puntos-input');
  const puntos = Math.floor(parseFloat(inp.value) || 0);
  const tasaCanje = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaCanje) || 300;
  const monto = Math.floor((puntos / tasaCanje) * 100) / 100;
  document.getElementById('canje-preview').textContent = `= ${sol(monto)} de descuento`;
}

async function confirmarCanje() {
  const inp = document.getElementById('canje-puntos-input');
  const clienteId = parseInt(inp.dataset.clienteId);
  const puntos = Math.floor(parseFloat(inp.value) || 0);
  if (!clienteId || puntos <= 0) { alert('Ingresa una cantidad de puntos válida.'); return; }
  const tasaCanje = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaCanje) || 300;
  const monto = Math.floor((puntos / tasaCanje) * 100) / 100;
  if (!confirm(`¿Confirmar canje de ${puntos} puntos por ${sol(monto)} de descuento?`)) return;
  const canje = await procesarCanje(clienteId, puntos);
  if (canje) {
    cerrarModal('modal-canje');
    alert('✅ Canje registrado: ' + sol(canje.montoDescuento) + ' de descuento aplicado.');
    actualizarPremioAlertPOS();
    try { calcTotal(); } catch(e) {}
  }
}

