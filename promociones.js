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
  sel.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre} (Stock: ${stockEnSede(p, sedeAdminEfectiva())} ${p.unidad})</option>`).join('');
  document.getElementById('merma-cant').value = '';
  document.getElementById('merma-obs').value = '';
  abrirModal('modal-merma');
}

let editingMermaId = null;
function editarMerma(id) {
  const m = DB.mermas.find(x => x.id === id);
  editingMermaId = id;
  const sel = document.getElementById('merma-prod');
  sel.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre} (Stock: ${stockEnSede(p, sedeAdminEfectiva())} ${p.unidad})</option>`).join('');
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
  const batch = writeBatchM(dbModular);

if (editingMermaId) {
    const old = DB.mermas.find(x => x.id === editingMermaId);
    const oldProd = DB.productos.find(p => p.id === old.prodId);
    const oldCant = old.cant;
    // Verificar disponibilidad simulando la restauracion, sin tocar nada todavia
    const stockSimulado = stockEnSede(prod, _sede) + (oldProd && oldProd.id === prod.id ? oldCant : 0);
    if (cant > stockSimulado) { alert('La cantidad supera el stock disponible en esa sede'); return; }

    const _deltasPorProducto = new Map();
    const _acumular = (p, delta) => {
      const actual = _deltasPorProducto.get(p.id);
      if (actual) actual.delta += delta; else _deltasPorProducto.set(p.id, { prod: p, delta });
    };
    if (oldProd) _acumular(oldProd, oldCant); // restaurar stock viejo
    _acumular(prod, -cant); // aplicar el nuevo descuento
    const _deltasStock = [];
    _deltasPorProducto.forEach(({prod: p, delta}) => {
      batch.set(docM(dbModular, 'stock', String(p.id)),
        { [`stockPorSede.${_sede}`]: incrementM(delta) }, { merge: true });
      _deltasStock.push({ prod: p, delta });
    });

    const _mermaActualizada = { ...old, prodId, cant, motivo, obs, sedeId: _sede, costoUnitario: prod.costo };
    batch.set(docM(dbModular, 'mermas', String(old.id)), _mermaActualizada);

    _sincIniciar('merma_lote', old.id);
    try {
      await batch.commit();
      _sincTerminar('merma_lote', old.id);
    } catch (e) {
      _sincError('merma_lote', old.id, e, 'la merma editada — no se aplicó nada');
      return;
    }
    _deltasStock.forEach(({prod: p, delta}) => {
      if (!p.stockPorSede) p.stockPorSede = { principal: p.stock||0 };
      p.stockPorSede[_sede] = Math.max(0, Math.round(((p.stockPorSede[_sede]||0)+delta)*1000)/1000);
      p.stock = stockTotal(p);
    });
    old.prodId = prodId; old.cant = cant; old.motivo = motivo; old.obs = obs; old.sedeId = _sede; old.costoUnitario = prod.costo;
    fbGuardar(); fbGuardarProductos();
  } else {
    if (cant > stockEnSede(prod, _sede)) { alert('La cantidad supera el stock disponible en esa sede'); return; }
    const nuevaMerma = { id: getId(), prodId, cant, motivo, obs, fecha: today(), usuario: currentUser, sedeId: _sede, costoUnitario: prod.costo };
    batch.set(docM(dbModular, 'stock', String(prod.id)),
      { [`stockPorSede.${_sede}`]: incrementM(-cant) }, { merge: true });
    batch.set(docM(dbModular, 'mermas', String(nuevaMerma.id)), nuevaMerma);

    _sincIniciar('merma_lote', nuevaMerma.id);
    try {
      await batch.commit();
      _sincTerminar('merma_lote', nuevaMerma.id);
    } catch (e) {
      _sincError('merma_lote', nuevaMerma.id, e, 'la merma — no se aplicó nada');
      return;
    }
    if (!prod.stockPorSede) prod.stockPorSede = { principal: prod.stock||0 };
    prod.stockPorSede[_sede] = Math.max(0, Math.round(((prod.stockPorSede[_sede]||0)-cant)*1000)/1000);
    prod.stock = stockTotal(prod);
    DB.mermas.push(nuevaMerma);
    fbGuardar(); fbGuardarProductos();
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
    batch.set(docM(dbModular, 'stock', String(prod.id)),
      { [`stockPorSede.${m.sedeId || sedeAdminEfectiva()}`]: incrementM(m.cant) }, { merge: true });
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
    const sede = m.sedeId || sedeAdminEfectiva();
    if (!prod.stockPorSede) prod.stockPorSede = { principal: prod.stock||0 };
    prod.stockPorSede[sede] = Math.max(0, Math.round(((prod.stockPorSede[sede]||0)+m.cant)*1000)/1000);
    prod.stock = stockTotal(prod);
    fbGuardarProductos();
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
    <td>${sol(p.precioOrig)}</td>
    <td style="color:var(--accent);font-weight:700">${sol(p.precioPromo)}</td>
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

function calcPromo() {
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
      if (!fbStorage) {
        document.getElementById('promo-img-data').value = previewData;
        return;
      }
      if (preview) preview.insertAdjacentHTML('afterend', '<span id="_promo-img-upload-lbl" style="font-size:.72rem;color:var(--primary)">⏳ Subiendo...</span>');
      canvas.toBlob(async (blob) => {
        try {
          const fileName = `promociones/${editingPromoId || Date.now()}.webp`;
          const ref = fbStorage.ref(fileName);
          await ref.put(blob, { contentType: 'image/webp' });
          const url = await ref.getDownloadURL();
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
  document.getElementById('promo-desde').value = pr.desde;
  document.getElementById('promo-hasta').value = pr.hasta;
  document.getElementById('promo-limite').value = pr.limite || 100;
  document.getElementById('promo-sede').value = pr.sedeId || '';
  const margen = pr.precioOrig > 0 ? Math.round((pr.precioPromo/pr.precioOrig-1)*100) : 20;
  document.getElementById('promo-margen-num').value = Math.max(0, margen);
  document.getElementById('promo-margen-slider').value = Math.max(0, margen);
  document.getElementById('promo-aviso').textContent = '';
  calcPromo();
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
  const hoy = today();
  const en7 = new Date(); en7.setDate(en7.getDate()+7);
  document.getElementById('promo-desde').value = hoy;
  document.getElementById('promo-hasta').value = en7.toISOString().split('T')[0];
  document.getElementById('promo-nombre').value = '';
  document.getElementById('promo-margen-num').value = 20;
  document.getElementById('promo-margen-slider').value = 20;
  document.getElementById('promo-precio-orig').value = '';
  document.getElementById('promo-precio-promo').value = '';
  document.getElementById('promo-calc-detalle').textContent = 'Selecciona al menos un producto';
  document.getElementById('promo-aviso').textContent = '';
  document.getElementById('promo-limite').value = 100;
  document.getElementById('promo-sede').value = '';
  document.getElementById('promo-img-data').value = '';
  document.getElementById('promo-img-file').value = '';
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
  const imagen = document.getElementById('promo-img-data').value || '';
  const tipo = document.getElementById('promo-tipo-sel').value;
  if (!nombre || !prod1Id) { alert('Completa nombre y producto 1'); return; }
  const costoTotal = (prod1?.costo||0) + (prod2?.costo||0) + (prod3?.costo||0);
  if (precioPromo < costoTotal && !confirm('El precio oferta está por debajo del costo. ¿Continuar?')) return;
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
    fbGuardarProductos();
    setTimeout(() => { _fbEscribiendo = false; }, 300);
    document.getElementById('promo-qr-wrap').style.display = 'block';
    document.getElementById('promo-qr-label').textContent = nombre;
    const el = document.getElementById('promo-qr-preview');
    if (el) { el.innerHTML = ''; new QRCode(el, { text: packCodigo, width: 120, height: 120 }); }
  } else if (espack && packProdId) {
    const prodPack = DB.productos.find(p => p.id === packProdId);
    if (prodPack) {
      prodPack.nombre = nombre;
      prodPack.precio = precioPromo;
      prodPack.costo = costoTotal;
      prodPack.imagen = imagen;
      prodPack.componentes = [
        { prodId: prod1Id, cant: 1 },
        ...(prod2Id ? [{ prodId: prod2Id, cant: 1 }] : []),
        ...(prod3Id ? [{ prodId: prod3Id, cant: 1 }] : [])
      ];
      fbGuardarProductos();
    }
  }
  const data = {
    nombre, tipo,
    prod1: prod1Id, prod1nombre: prod1?.nombre || null,
    prod2: prod2Id, prod2nombre: prod2?.nombre || null,
    prod3: prod3Id, prod3nombre: prod3?.nombre || null,
    precioOrig, precioPromo,
    desde: document.getElementById('promo-desde').value,
    hasta: document.getElementById('promo-hasta').value,
    activa: true, limite, vendidos: 0,
    imagen, packProdId, packCodigo,
    sedeId: document.getElementById('promo-sede')?.value || ''
  };
  // CRITICO: promociones ahora tiene su propia coleccion (mismo criterio que ventas,
  // clientes, etc.) — ya no depende de guardarse como parte de aleze/db via fbGuardar().
  let _promoFinal;
  if (editingPromoId) {
    const idx = DB.promociones.findIndex(x => x.id === editingPromoId);
    if (idx >= 0) DB.promociones[idx] = { ...DB.promociones[idx], ...data };
    _promoFinal = DB.promociones[idx];
  } else {
    _promoFinal = { id: getId(), ...data };
    DB.promociones.push(_promoFinal);
  }
  if (dbModular) setDocM(docM(dbModular, 'promociones', String(_promoFinal.id)), _promoFinal).catch(e => console.warn('No se pudo guardar promociones/'+_promoFinal.id, e)); // [SDK modular]
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
    if (prodPack) { prodPack.promoActiva = p.activa; fbGuardarProductos(); }
  }
  if (dbModular) setDocM(docM(dbModular, 'promociones', String(id)), { activa: p.activa }, { merge: true }).catch(e => console.warn('No se pudo actualizar promociones/'+id, e)); // [SDK modular]
  renderPromociones();
  try { renderPosGrid(); } catch(e){}
  try { renderMobPosGrid(); } catch(e){}
}
function eliminarPromo(id) {
  if (!confirm('¿Eliminar?')) return;
  const p = DB.promociones.find(x => x.id === id);
  if (p && p.packProdId) {
    DB.productos = DB.productos.filter(x => x.id !== p.packProdId);
    fbGuardarProductos();
    // Limpia el documento huérfano en stock/{id} — el pack no trackea stock real (se arma
    // de sus componentes), pero el doc igual quedaría abandonado si no se borra explícito.
    if (dbModular) deleteDocM(docM(dbModular, 'stock', String(p.packProdId))).catch(()=>{}); // [SDK modular]
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

