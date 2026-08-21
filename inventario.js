// ===================== INVENTARIO =====================
function renderInventario() {
  try { initExcelPanel(); } catch(e) {}
  updateInvCatFilter();
  updateInvProvFilter();
  renderInvTable();
}

function updateInvCatFilter() {
  const sel = document.getElementById('inv-cat');
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  DB.categorias.forEach(c => {
    // <select> options don't render HTML — use emoji if no image, or label with name
    const label = c.emoji ? c.emoji + ' ' + c.nombre : c.nombre;
    sel.innerHTML += `<option value="${c.id}">${label}</option>`;
  });
}

// ── Filtro de proveedor en Inventario ─────────────────────────────────────
// Objetivo real (pedido explícito del usuario): con el filtro de "Stock bajo" solo, la lista
// mezcla productos de TODOS los proveedores — para el caso de uso real (vendedor con el
// proveedor en llamada, decidiendo qué pedir ahí mismo) hace falta acotar además por
// proveedor, para ver de un vistazo solo lo que ESE proveedor puede reponer. Mismo patrón que
// updateInvCatFilter() — reconstruye el <select> desde DB.proveedores en cada render.
function updateInvProvFilter() {
  const sel = document.getElementById('inv-prov');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todos los proveedores</option>';
  (DB.proveedores || []).forEach(p => sel.innerHTML += `<option value="${p.id}">${p.nombre}</option>`);
}

// ── Proveedor(es) de un producto — un producto puede conseguirse de varios proveedores
// distintos (cercanía de reparto, fecha, precio del momento), no solo uno. `provs` es el campo
// real (arreglo de ids); `prov` (un solo id o null) es el campo viejo de antes de este cambio
// — se mantiene sin tocar en cualquier producto que ya lo tuviera, nunca se pierde un dato ya
// guardado. Este helper es la ÚNICA forma correcta de leer los proveedores de un producto en
// todo el sistema — nunca leer `p.prov`/`p.provs` directo fuera de acá.
function _provsDeProducto(p) {
  if (!p) return [];
  if (Array.isArray(p.provs)) return p.provs;
  return (p.prov != null && p.prov !== '') ? [p.prov] : [];
}

// Celda "ID_Proveedor" del Excel de inventario — uno o varios ids separados por coma/punto y
// coma (ej. "3,7" o "3; 7"). Usado tanto al detectar diferencias como al crear un producto
// nuevo desde el Excel (ver reportes.js).
function _parseProveedoresExcel(v) {
  return String(v||'').split(/[,;]/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}

function renderInvTable(prods) {
  prods = prods || DB.productos;
  const tbody = document.getElementById('inv-tbody');
  // Bug real: stockEnSede(p) sin segundo argumento usa la sede de quien inició sesión, no la
  // sede efectiva del selector de admin — por eso cambiar de sede no cambiaba este número.
  const _sedeInv = sedeAdminEfectiva();
  tbody.innerHTML = prods.map(p => {
    const _stockAqui = stockEnSede(p, _sedeInv);
    const dias = diasHasta(p.venc);
    let estado = '<span class="badge badge-green">✅ OK</span>';
    if (_stockAqui <= p.stockMin) estado = '<span class="badge badge-red">⚠️ Stock bajo</span>';
    if (p.venc && dias <= 7 && dias >= 0) estado = '<span class="badge badge-orange">⏰ Vence pronto</span>';
    if (p.venc && dias < 0) estado = '<span class="badge badge-red">❌ Vencido</span>';
    const margenPct = p.costo > 0 ? ((p.precio - p.costo) / p.costo * 100).toFixed(1) + '%' : '-';
    const margenSol = sol(p.precio - p.costo);
    return `<tr>
      <td style="font-family:monospace;font-size:0.75rem">${p.codigo}</td>
      <td><strong>${p.nombre}</strong></td>
      <td>${getCategoriaNombre(p.cat)}</td>
      <td><span class="badge badge-${p.tipo==='granel'?'blue':'gray'}">${p.tipo==='granel'?'Granel':'Unidad'}</span></td>
     <td>
  <strong style="color:${_stockAqui<=p.stockMin?'var(--danger)':'inherit'}">
    ${p.unidad === 'kg' ? parseFloat(Number(_stockAqui || 0).toFixed(3)) : parseFloat(Number(_stockAqui || 0).toFixed(2))} ${p.unidad}
  </strong>
</td>
      <td>${p.stockMin}</td>
      <td>${sol(p.costo)}</td>
      <td><strong>${sol(p.precio)}</strong></td>
      <td style="color:var(--accent);font-weight:700">${margenPct}</td>
      <td style="color:var(--accent-dark)">${margenSol}</td>
      <td>${p.venc ? formatDate(p.venc) : '-'}</td>
      <td>${estado}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-xs" onclick="editarProducto(${p.id})">✏️ Editar</button>
        <button class="btn btn-outline btn-xs" onclick="verCodigoBarras(${p.id})" title="Ver/imprimir código de barras">🔖</button>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarProducto(${p.id})">🗑️</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" style="text-align:center;padding:1.5rem;color:var(--gray-400)">Sin productos</td></tr>';
}

function _invEnterScan() {
  const s = document.getElementById('inv-search')?.value || '';
  if (!s) return;
  const matches = DB.productos.filter(p =>
    _norm(p.codigo||'') === _norm(s) ||
    _norm(p.nombre).includes(_norm(s)) ||
    _norm(p.codigo||'').includes(_norm(s))
  );
  if (matches.length === 1) {
    document.getElementById('inv-search').value = '';
    filterInventario();
    editarProducto(matches[0].id);
  }
}
function filterInventario() {
  const s = document.getElementById('inv-search').value.toLowerCase();
  const cat = document.getElementById('inv-cat').value;
  const estado = document.getElementById('inv-estado').value;
  const prov = document.getElementById('inv-prov')?.value || '';
  let prods = DB.productos;
if (s) prods = prods.filter(p => _norm(p.nombre).includes(_norm(s)) || _norm(p.codigo||'').includes(_norm(s)));
  if (cat) prods = prods.filter(p => p.cat == cat);
  if (prov) prods = prods.filter(p => _provsDeProducto(p).some(id => id == prov));
  if (estado === 'bajo') prods = prods.filter(p => stockEnSede(p) <= p.stockMin);
  if (estado === 'vence') prods = prods.filter(p => p.venc && diasHasta(p.venc) <= 7 && diasHasta(p.venc) >= 0);
  if (estado === 'ok') prods = prods.filter(p => stockEnSede(p) > p.stockMin && (!p.venc || diasHasta(p.venc) > 7));
  renderInvTable(prods);
}


// ── Stock: un solo campo plano "stock" por producto — ya no hay mas de una sede ──
// CAUSA RAIZ REAL de la corrupcion de stock que persistio durante toda la migracion:
// {[`stockPorSede.${sede}`]: incrementM(delta)} con setDoc+merge NO crea un campo anidado
// stockPorSede:{principal:N} como el codigo de lectura siempre asumio — crea un campo PLANO
// cuyo NOMBRE LITERAL es el string completo "stockPorSede.principal" (el punto es parte del
// nombre, no un separador de ruta). Confirmado con el volcado crudo directo del documento en
// Firestore. El incremento SI llegaba al servidor y SI se acumulaba correctamente (por eso el
// valor real seguia creciendo en cada prueba) — pero ninguna lectura en todo el sistema
// buscaba ese nombre exacto, todas buscaban una estructura anidada que nunca existio, asi que
// siempre leian 0 y volvian a sumar desde cero. No era cache, no eran reglas, no era la red.
function stockEnSede(prod) {
  if (!prod) return 0;
  if (prod.esCombo) return _stockComboDisponible(prod);
  return prod.stock || 0;
}
function stockTotal(prod) {
  if (!prod) return 0;
  if (prod.esCombo) return _stockComboDisponible(prod);
  return prod.stock || 0;
}
// Cuantos packs son realmente armables AHORA MISMO, segun el stock real de sus componentes —
// reemplaza el numero fijo artificial (999) que se guardaba antes, que nunca reflejaba
// disponibilidad real. Al calcularse en vivo desde DB.productos (nunca un valor cacheado),
// toda la validacion de stock que ya existe para productos normales (la que sí compara
// correctamente contra lo que ya hay en el carrito) empieza a funcionar tambien para combos,
// sin necesitar chequeos especiales duplicados en cada punto de entrada del sistema.
function _stockComboDisponible(prod) {
  if (!prod.componentes || !prod.componentes.length) return prod.stock || 0; // dato incompleto — respaldo seguro
  let minDisponible = Infinity;
  for (const comp of prod.componentes) {
    const cp = DB.productos.find(p => p.id === comp.prodId);
    // Componente eliminado del catalogo, o (caso extremo que la interfaz ya bloquea al crear,
    // pero blindado igual por si el dato llega corrupto de otra forma) el componente es a su
    // vez otro combo — no soportado, se trata como sin stock en vez de recursar.
    if (!cp || cp.esCombo) return 0;
    const disponiblePorEsteComponente = Math.floor((cp.stock || 0) / (comp.cant || 1));
    if (disponiblePorEsteComponente < minDisponible) minDisponible = disponiblePorEsteComponente;
  }
  return minDisponible === Infinity ? 0 : minDisponible;
}
// ── Incremento atómico de stock — directamente sobre el documento del producto ──
function fbIncrementarStock(prodId, delta) {
  if (!dbModular || prodId == null || !delta) return; // [SDK modular]
  _sincIniciar('productos', String(prodId));
  setDocM(docM(dbModular, 'productos', String(prodId)),
    { stock: incrementM(delta) },
    { merge: true }
  ).then(() => _sincTerminar('productos', String(prodId)))
   .catch(e => _sincError('productos', String(prodId), e, 'el stock del producto'));
}

function ajustarStockSede(prod, delta) {
  if (!prod) return;
  prod.stock = Math.max(0, Math.round(((prod.stock||0) + delta) * 1000) / 1000);
  fbIncrementarStock(prod.id, delta);
}

function abrirModalProducto() {
  editingProductId = null;
  document.getElementById('modal-prod-titulo').textContent = 'Nuevo Producto';
  document.getElementById('prod-stock-wrap').style.display = 'block';
  // Revertir lo que el modo edicion deja (campo deshabilitado, etiqueta cambiada) — el modal
  // se reutiliza entre crear y editar, sin esto un producto nuevo heredaria el estado de edicion.
  document.getElementById('prod-stock').disabled = false;
  document.querySelector('#prod-stock-wrap label').textContent = 'Stock inicial *';
  document.getElementById('prod-stock-nota').style.display = 'none';
  // Solo inputs/selects — NO incluir divs como prod-margen-cat-label
  ['prod-nombre','prod-marca','prod-costo','prod-precio','prod-stock','prod-venc','prod-codigo','prod-precio-sugerido'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  // Limpiar el div de etiqueta de margen por separado
  const lbl = document.getElementById('prod-margen-cat-label');
  if (lbl) lbl.textContent = '';
  document.getElementById('prod-stock-min').value = '5';
  document.getElementById('prod-margen').value = '';
  document.getElementById('barcode-container').style.display = 'none';
  // Clear image
  document.getElementById('prod-img-data').value = '';
  document.getElementById('prod-img-file').value = '';
  const _prevImg = document.getElementById('prod-img-preview');
  if (_prevImg) { _prevImg.innerHTML = '🖼️'; _prevImg.style.fontSize='2rem'; }
  // Resetear seccion de detalle
  document.getElementById('prod-tiene-detalle').checked = false;
  document.getElementById('prod-es-impulso').checked = false;
  document.getElementById('prod-detalle-wrap').style.display = 'none';
  document.getElementById('prod-desc-extendida').value = '';
  document.getElementById('prod-tiene-mayor').checked = false;
  document.getElementById('prod-mayor-wrap').style.display = 'none';
  document.getElementById('prod-mayor-cant').value = '';
  document.getElementById('prod-mayor-precio').value = '';
  ['1','2'].forEach(slot => {
    document.getElementById(`prod-img-extra-${slot}-data`).value = '';
    const p = document.getElementById(`prod-img-extra-${slot}-preview`);
    if (p) p.innerHTML = '🖼️';
  });
  updateModalCats(); updateModalProvs();
  _actualizarListaMarcas();
  abrirModal('modal-producto');
}

// Autocompletado nativo (datalist) con las marcas ya usadas en el catalogo — evita que la
// misma marca termine escrita de formas distintas ("Gloria" / "gloria" / "GLORIA") por
// tipeo libre, sin forzar una lista cerrada (el campo sigue siendo texto libre).
function _actualizarListaMarcas() {
  const dl = document.getElementById('prod-marca-lista');
  if (!dl) return;
  const marcas = [...new Set((DB.productos||[]).map(p => p.marca).filter(Boolean))].sort();
  dl.innerHTML = marcas.map(m => `<option value="${m}"></option>`).join('');
}

function editarProducto(id) {
  const p = DB.productos.find(x => x.id === id);
  if (!p) { alert('Producto no encontrado'); return; }
  editingProductId = id;
  document.getElementById('modal-prod-titulo').textContent = 'Editar Producto';
  document.getElementById('prod-nombre').value = p.nombre;
  document.getElementById('prod-marca').value = p.marca || '';
  document.getElementById('prod-tipo').value = p.tipo;
  document.getElementById('prod-unidad').value = p.unidad;
  document.getElementById('prod-costo').value = p.costo;
  document.getElementById('prod-precio').value = p.precio;
  // El stock no se edita directo (a proposito, ver la nota) pero ahora se muestra en modo
  // solo lectura junto con la explicacion — antes quedaba todo oculto sin decir nada, la nota
  // ya existia en el codigo pero nunca se hacia visible.
  document.getElementById('prod-stock-wrap').style.display = 'block';
  document.getElementById('prod-stock').value = stockEnSede(p, sedeAdminEfectiva());
  document.getElementById('prod-stock').disabled = true;
  document.querySelector('#prod-stock-wrap label').textContent = 'Stock actual';
  document.getElementById('prod-stock-nota').style.display = 'block';
  document.getElementById('prod-stock-min').value = p.stockMin;
  document.getElementById('prod-venc').value = p.venc || '';
  document.getElementById('prod-codigo').value = p.codigo;
  updateModalCats();
  document.getElementById('prod-cat').value = p.cat;
  updateModalProvs();
  const _provsSel = _provsDeProducto(p);
  document.querySelectorAll('#prod-prov-lista input[type="checkbox"]').forEach(chk => {
    chk.checked = _provsSel.includes(parseInt(chk.value));
  });
  calcMargen();
  actualizarPrecioSugerido();
  if (p.codigo) {
    document.getElementById('barcode-container').style.display = 'block';
    document.getElementById('barcode-prod-nombre-label').textContent = p.nombre;
    _renderQrPreview(p.codigo);
  } else {
    document.getElementById('barcode-container').style.display = 'none';
  }
  // Load product image
  const imgData = p.imagen || '';
  document.getElementById('prod-img-data').value = imgData;
  const preview = document.getElementById('prod-img-preview');
  if (imgData) {
    preview.innerHTML = `<img src="${imgData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />`;
  } else {
    preview.innerHTML = '🖼️';
    preview.style.fontSize = '2rem';
  }
  // Detalle: se lee de su colección propia solo si el producto la usa — no en cada carga del catálogo.
  document.getElementById('prod-tiene-detalle').checked = !!p.tieneDetalle;
  document.getElementById('prod-es-impulso').checked = !!p.esImpulso;
  document.getElementById('prod-detalle-wrap').style.display = p.tieneDetalle ? 'block' : 'none';
  document.getElementById('prod-desc-extendida').value = '';
  document.getElementById('prod-tiene-mayor').checked = false;
  document.getElementById('prod-mayor-wrap').style.display = 'none';
  document.getElementById('prod-mayor-cant').value = '';
  document.getElementById('prod-mayor-precio').value = '';
  ['1','2'].forEach(slot => {
    document.getElementById(`prod-img-extra-${slot}-data`).value = '';
    const pv = document.getElementById(`prod-img-extra-${slot}-preview`);
    if (pv) pv.innerHTML = '🖼️';
  });
  if (p.tieneDetalle && dbModular) { // [SDK modular]
    getDocM(docM(dbModular, 'productos_detalle', String(id))).then(doc => {
      if (!doc.exists()) return; // en modular, exists es un METODO, no una propiedad
      const d = doc.data();
      document.getElementById('prod-desc-extendida').value = d.descripcion || '';
      (d.imagenesExtra || []).forEach((url, i) => {
        if (i > 1) return;
        document.getElementById(`prod-img-extra-${i+1}-data`).value = url;
        const pv = document.getElementById(`prod-img-extra-${i+1}-preview`);
        if (pv) pv.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>`;
      });
      if (d.precioMayor) {
        document.getElementById('prod-tiene-mayor').checked = true;
        document.getElementById('prod-mayor-wrap').style.display = 'flex';
        document.getElementById('prod-mayor-cant').value = d.precioMayor.cantidadMin || '';
        document.getElementById('prod-mayor-precio').value = d.precioMayor.precio || '';
      }
    }).catch(e => console.warn('No se pudo cargar el detalle:', e));
  }
  _actualizarListaMarcas();
  abrirModal('modal-producto');
}

function onProdImgSelect(e) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede subir imágenes de producto.'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      // CRITICO: antes forzaba 128x128 con recorte centrado — suficiente para la tarjeta
      // chica de antes, pero al mostrar esta misma imagen ampliada en el detalle de tienda
      // publica (hasta 430px de ancho), se veia pixeleada — una imagen de 128px estirada mas
      // de 3 veces su tamaño real. Ademas, el recorte cuadrado forzado perdia permanentemente
      // los bordes de fotos que no eran cuadradas en origen, sin forma de recuperarlos despues.
      // Ahora: 700px maximo (nitido en el detalle ampliado, sigue viendose perfecto reducido
      // en la tarjeta chica), preservando la proporcion original — sin recortar nada. Como
      // sube a Storage (no a Firestore), esto no cuesta nada en el limite de 1MB por
      // documento ni en cuota de lecturas — solo un archivo WebP de unos 40-70KB en Storage.
      const MAX_DIM = 700;
      const ratioProd = Math.min(MAX_DIM / img.width, MAX_DIM / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratioProd);
      canvas.height = Math.round(img.height * ratioProd);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Mostrar preview inmediato con base64 mientras sube
      const previewData = canvas.toDataURL('image/webp', 0.82);
      const preview = document.getElementById('prod-img-preview');
      if (preview) preview.innerHTML = `<img src="${previewData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
      // Subir a Firebase Storage en lugar de guardar base64
      if (!storageModular) {
        document.getElementById('prod-img-data').value = previewData;
        return;
      }
      if (preview) preview.insertAdjacentHTML('afterend', '<span id="_img-upload-lbl" style="font-size:.72rem;color:var(--primary)">⏳ Subiendo...</span>');
      canvas.toBlob(async (blob) => {
        try {
          const fileName = `productos/${editingProductId || Date.now()}.webp`;
          const ref = refM(storageModular, fileName);
          // cacheControl: 30 dias — seguro, cada resubida genera un token nuevo en la URL
          // (confirmado: getDownloadURL() despues de put() siempre da una URL distinta), asi
          // que un cache largo nunca puede mostrar una foto vieja por error. Sin esto, el
          // navegador volvia a descargar el catalogo completo de fotos cada 1 hora (default
          // de Storage), en cada recarga de la tienda — con o sin bots de por medio.
          await uploadBytesM(ref, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=2592000' });
          const url = await getDownloadURLM(ref);
          document.getElementById('prod-img-data').value = url;
          const lbl = document.getElementById('_img-upload-lbl');
          if (lbl) lbl.remove();
       } catch(err) {
          // Si falla Storage, usa base64 como fallback
          document.getElementById('prod-img-data').value = previewData;
          const lbl = document.getElementById('_img-upload-lbl');
          if (lbl) lbl.textContent = '⚠️ Error Storage — imagen guardada local';
        }
      }, 'image/webp', 0.82);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Detalle de producto (tienda pública): datos pesados, colección propia (productos_detalle),
// separada del catálogo base — así un ajo suelto nunca paga por esto, ni en tamaño ni en lecturas.
function _toggleDetalleProducto() {
  document.getElementById('prod-detalle-wrap').style.display =
    document.getElementById('prod-tiene-detalle').checked ? 'block' : 'none';
}

// Fotos extra: mismo patrón que la imagen principal — sube a Storage, guarda solo la URL.
function onProdImgExtraSelect(e, slot) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede subir imágenes de producto.'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      // Sin recorte forzado (antes perdia permanentemente los bordes de fotos no cuadradas) —
      // preserva proporcion original, 200px sigue siendo de sobra para la miniatura de 56px.
      const ratioExtra = Math.min(200 / img.width, 200 / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratioExtra);
      canvas.height = Math.round(img.height * ratioExtra);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const previewData = canvas.toDataURL('image/webp', 0.78);
      const preview = document.getElementById(`prod-img-extra-${slot}-preview`);
      if (preview) preview.innerHTML = `<img src="${previewData}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>`;
      if (!storageModular) {
        document.getElementById(`prod-img-extra-${slot}-data`).value = previewData;
        return;
      }
      canvas.toBlob(async (blob) => {
        try {
          const fileName = `productos_detalle/${editingProductId || Date.now()}_${slot}.webp`;
          const ref = refM(storageModular, fileName);
          await uploadBytesM(ref, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=2592000' });
          const url = await getDownloadURLM(ref);
          document.getElementById(`prod-img-extra-${slot}-data`).value = url;
        } catch(err) {
          document.getElementById(`prod-img-extra-${slot}-data`).value = previewData;
        }
      }, 'image/webp', 0.78);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Escribe/borra el registro de detalle — colección aparte, lectura pública (la tienda no
// tiene login), escritura solo admin.
function fbGuardarDetalleProducto(prodId, detalle) {
  if (!dbModular) return; // [SDK modular]
  _sincIniciar('detalle_producto', prodId);
  setDocM(docM(dbModular, 'productos_detalle', String(prodId)), detalle)
    .then(() => _sincTerminar('detalle_producto', prodId))
    .catch(e => _sincError('detalle_producto', prodId, e, 'el detalle del producto'));
}
function fbBorrarDetalleProducto(prodId) {
  if (!dbModular) return; // [SDK modular]
  deleteDocM(docM(dbModular, 'productos_detalle', String(prodId))).catch(()=>{});
}

function limpiarImgProd() {
  document.getElementById('prod-img-data').value = '';
  document.getElementById('prod-img-file').value = '';
  const preview = document.getElementById('prod-img-preview');
  preview.innerHTML = '🖼️';
  preview.style.fontSize = '2rem';
}

function eliminarProducto(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar productos.'); return; }
  if (!confirm('¿Eliminar este producto?')) return;
  const tieneFiado = DB.fiados.some(f => f.items.some(i => i.prodId === id));
  if (tieneFiado) { alert('Este producto tiene fiados pendientes. Salda los fiados antes de eliminarlo.'); return; }
  DB.productos = DB.productos.filter(p => p.id !== id); fbGuardarProducto(id);
  renderInvTable();
}

function updateModalCats() {
  const sel = document.getElementById('prod-cat');
  sel.innerHTML = '<option value="">Seleccionar categoría...</option>';
  DB.categorias.forEach(c => sel.innerHTML += `<option value="${c.id}">${c.emoji} ${c.nombre}${c.margen?' ('+c.margen+'%)':''}</option>`);
}

function updateModalProvs() {
  // Checklist con buscador (reemplaza al <select multiple> nativo — con Ctrl/Cmd+clic
  // funcionaba pero era confuso para un usuario sin ese hábito, y no escalaba a listas
  // largas de proveedores). Se pinta la lista COMPLETA una sola vez aquí; buscar solo
  // oculta/muestra filas (_prodProvFiltrar) — nunca se reconstruye el HTML mientras se
  // busca, así que lo marcado no se pierde al filtrar.
  const cont = document.getElementById('prod-prov-lista');
  cont.innerHTML = DB.proveedores.map(p => `
    <label data-prov-nombre="${_norm(p.nombre)}" style="display:flex;align-items:center;gap:.45rem;padding:.3rem 0;cursor:pointer">
      <input type="checkbox" value="${p.id}" style="width:auto;margin:0">
      <span>${escapeHtml(p.nombre)}</span>
    </label>`).join('') || '<div style="color:var(--gray-400);padding:.3rem 0">No hay proveedores registrados todavía.</div>';
  const buscar = document.getElementById('prod-prov-buscar');
  if (buscar) buscar.value = '';
  const sp = document.getElementById('promo-prod1');
  const sp2 = document.getElementById('promo-prod2');
  if (sp) { sp.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join(''); }
  if (sp2) { sp2.innerHTML = '<option value="">Segundo producto (opcional)</option>' + DB.productos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join(''); }
}

// Filtra visualmente el checklist de proveedores del modal de producto — no toca los
// checkboxes marcados, solo oculta/muestra filas (ver comentario en updateModalProvs).
function _prodProvFiltrar() {
  const q = _norm((document.getElementById('prod-prov-buscar')?.value || '').trim());
  document.querySelectorAll('#prod-prov-lista label[data-prov-nombre]').forEach(lbl => {
    lbl.style.display = (!q || lbl.dataset.provNombre.includes(q)) ? 'flex' : 'none';
  });
}

function calcMargen() {
  const c = parseFloat(document.getElementById('prod-costo').value) || 0;
  const v = parseFloat(document.getElementById('prod-precio').value) || 0;
  if (c > 0 && v > 0) {
    const m = ((v - c) / c * 100).toFixed(1);
    const ganSol = sol(v - c);
    document.getElementById('prod-margen').value = m + '% (' + ganSol + ') ' + (v > c ? '✅' : '❌ Pérdida');
  }
}

function toggleTipo() { }

// Precio sugerido con redondeo al 0.10 superior
function actualizarPrecioSugerido() {
  const catId = parseInt(document.getElementById('prod-cat').value);
  const costo = parseFloat(document.getElementById('prod-costo').value) || 0;
  const cat = DB.categorias.find(c => c.id == catId);
  if (!cat || !cat.margen || costo <= 0) {
    document.getElementById('prod-precio-sugerido').value = '';
    document.getElementById('prod-margen-cat-label').textContent = '';
    return;
  }
  const raw = costo * (1 + cat.margen / 100);
  const sugerido = Math.ceil(raw * 10) / 10;
  document.getElementById('prod-precio-sugerido').value = sugerido.toFixed(2);
  document.getElementById('prod-margen-cat-label').textContent =
    'Categoría ' + cat.nombre + ': ' + cat.margen + '% → S/' + raw.toFixed(4) + ' → redondeado S/' + sugerido.toFixed(2);
}

function usarPrecioSugerido() {
  const s = document.getElementById('prod-precio-sugerido').value;
  if (s) { document.getElementById('prod-precio').value = s; calcMargen(); }
}

function previsualizarCodigo() {
  const codigo = document.getElementById('prod-codigo').value.trim();
  if (codigo.length >= 6) {
    document.getElementById('barcode-container').style.display = 'block';
    document.getElementById('barcode-prod-nombre-label').textContent = document.getElementById('prod-nombre').value || 'Producto';
    _renderQrPreview(codigo);
  } else {
    document.getElementById('barcode-container').style.display = 'none';
  }
}

function generarCodigo() {
  const codigo = '7' + Date.now().toString().slice(-12);
  document.getElementById('prod-codigo').value = codigo;
  document.getElementById('barcode-container').style.display = 'block';
  document.getElementById('barcode-prod-nombre-label').textContent = document.getElementById('prod-nombre').value || 'Producto';
  _renderQrPreview(codigo);
}

// ── Helper: renderiza el QR en #qr-preview (limpia el div antes de re-renderizar)
function _renderQrPreview(codigo) {
  const el = document.getElementById('qr-preview');
  if (!el) return;
  el.innerHTML = ''; // limpiar QR anterior
  if (typeof QRCode === 'undefined') {
    el.textContent = codigo;
    return;
  }
  new QRCode(el, {
    text: codigo,
    width: 140,
    height: 140,
    colorDark: '#1F2937',
    colorLight: '#FFFFFF',
    correctLevel: QRCode.CorrectLevel.M
  });
}

// ── Imprimir QR de estante: 1 hoja grande por producto, para pegar donde están las unidades
function imprimirQrEstante() {
  const codigo = document.getElementById('prod-codigo').value.trim();
  const nombre = document.getElementById('prod-nombre').value.trim() || 'Producto';
  const precio = parseFloat(document.getElementById('prod-precio').value) || 0;
  const cat    = document.getElementById('prod-cat');
  const catNombre = cat && cat.options[cat.selectedIndex] ? cat.options[cat.selectedIndex].text : '';
  if (!codigo) { alert('Primero ingresa o genera un código para el producto'); return; }

  // Generar el QR como data-URL usando QRCode.js en un canvas oculto
  const tmpDiv = document.createElement('div');
  tmpDiv.style.position = 'absolute';
  tmpDiv.style.left = '-9999px';
  document.body.appendChild(tmpDiv);

  try {
    if (typeof QRCode === 'undefined') throw new Error('Librería QR no disponible');
    const qr = new QRCode(tmpDiv, {
      text: codigo,
      width: 300,
      height: 300,
      colorDark: '#1F2937',
      colorLight: '#FFFFFF',
      correctLevel: QRCode.CorrectLevel.M
    });

    // Esperar a que el canvas se genere (QRCode.js es síncrono pero necesita el DOM)
    setTimeout(() => {
      const canvas = tmpDiv.querySelector('canvas');
      const imgSrc = canvas ? canvas.toDataURL('image/png') : '';
      document.body.removeChild(tmpDiv);

      const precioStr = 'S/ ' + precio.toFixed(2);
      const html = [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<title>QR Estante — ', nombre, '</title>',
        '<style>',
          '*{box-sizing:border-box;margin:0;padding:0}',
          'body{font-family:Arial,sans-serif;background:#f3f4f6;padding:12px}',
          /* Barra de acciones — solo pantalla */
          '.acciones{background:#7C3AED;color:#fff;padding:8px 12px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
          '.acciones span{flex:1;font-size:12px;font-weight:700}',
          '.acciones button{padding:5px 12px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer}',
          '.btn-p{background:#fff;color:#7C3AED}',
          '.btn-c{background:rgba(255,255,255,.2);color:#fff}',
          /* Grid de tarjetas */
          '.grid{display:flex;flex-wrap:wrap;gap:8px}',
          /* Tarjeta: 6×6 cm aprox a 96dpi ≈ 226px, pero usamos cm en print */
          '.tarjeta{width:6cm;background:#fff;border:1.5px solid #374151;border-radius:6px;padding:5px;text-align:center;page-break-inside:avoid}',
          '.t-nombre{font-size:7.5pt;font-weight:800;color:#111;line-height:1.2;margin-bottom:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
          '.t-qr img{width:100%;height:auto;display:block}',
          '.t-precio{font-size:13pt;font-weight:900;color:#111;margin:3px 0 1px}',
          '.t-cod{font-family:monospace;font-size:5.5pt;color:#9CA3AF}',
          '@media print{',
            'body{background:#fff;padding:6mm}',
            '.acciones{display:none}',
            '.grid{gap:5mm}',
            '.tarjeta{border:1px solid #000;border-radius:3px;padding:3mm;width:55mm}',
            '.t-precio{color:#000}',
          '}',
        '</style></head><body>',
        '<div class="acciones">',
          '<span>🏷️ QR Estante — ', nombre, ' &nbsp;·&nbsp; ', precioStr, '</span>',
          '<button class="btn-p" onclick="window.print()">🖨️ Imprimir</button>',
          '<button class="btn-c" onclick="window.close()">✕ Cerrar</button>',
        '</div>',
        '<div class="grid">',
        /* Repetir 4 tarjetas — caben cómodamente en 1 hoja A4 en 2 columnas */
        ...[1,2,3,4].map(() => [
          '<div class="tarjeta">',
            '<div class="t-nombre">', nombre, '</div>',
            '<div class="t-qr">',
              imgSrc ? '<img src="' + imgSrc + '" alt="QR">' : '<p style="color:red;font-size:8pt">Error QR</p>',
            '</div>',
            '<div class="t-precio">', precioStr, '</div>',
            '<div class="t-cod">', codigo, '</div>',
          '</div>'
        ].join('')),
        '</div>',
        '</body></html>'
      ].join('');

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = url; a.download = 'qr-estante-' + nombre.replace(/\s+/g,'-') + '.html'; a.click();
        alert('Popups bloqueados — se descargó el archivo. Ábrelo e imprime.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, 100);

  } catch(e) {
    if (document.body.contains(tmpDiv)) document.body.removeChild(tmpDiv);
    alert('Error generando QR: ' + e.message);
  }
}

function guardarCategoria() {
  if (currentRole !== 'admin') return;
  const nombre = document.getElementById('cat-nombre').value.trim();
  if (!nombre) { alert('El nombre es obligatorio'); return; }
  const emoji  = document.getElementById('cat-emoji').value.trim() || '📦';
  const margen = parseFloat(document.getElementById('cat-margen').value) || 0;
  const imagen = document.getElementById('cat-img-data').value || '';
  const oculta = document.getElementById('cat-oculta')?.checked || false;
  if (editingCatId) {
    const c = DB.categorias.find(x => x.id === editingCatId);
    if (c) { c.nombre = nombre; c.emoji = emoji; c.margen = margen; c.imagen = imagen; c.oculta = oculta; }
  } else {
    DB.categorias.push({ id: getId(), nombre, emoji, margen, imagen, oculta });
  }
  fbGuardarProductos('categorias');
  cerrarModal('modal-categoria');
  renderCategorias();
  try { renderPos(); } catch(e){}
  try { updateInvCatFilter(); } catch(e){}
  try { updateModalCats(); } catch(e){}
}

function verCodigoBarras(id) {
  const p = DB.productos.find(x => x.id === id);
  if (!p) { alert('Producto no encontrado'); return; }
  editingProductId = id;
  // Llenar campos del modal para que imprimirQrEstante funcione
  document.getElementById('prod-nombre').value = p.nombre;
  document.getElementById('prod-codigo').value = p.codigo;
  document.getElementById('prod-precio').value = p.precio;
  document.getElementById('barcode-prod-nombre-label').textContent = p.nombre;
  document.getElementById('barcode-container').style.display = 'block';
  const lbl = document.getElementById('prod-margen-cat-label');
  if (lbl) lbl.textContent = '';
  _renderQrPreview(p.codigo);
  abrirModal('modal-producto');
}

function guardarProducto() {
  if (currentRole !== 'admin') return;
  const nombre = document.getElementById('prod-nombre').value.trim();
  const cat = parseInt(document.getElementById('prod-cat').value);
  const costo = parseFloat(document.getElementById('prod-costo').value);
  const precio = parseFloat(document.getElementById('prod-precio').value);
  if (!nombre || !cat || isNaN(costo) || isNaN(precio)) { alert('Completa los campos obligatorios'); return; }

  const existente = editingProductId ? DB.productos.find(p => p.id === editingProductId) : null;

  const tieneDetalle = document.getElementById('prod-tiene-detalle')?.checked || false;
  const prod = {
    id: editingProductId || getId(),
    nombre, cat,
    marca: document.getElementById('prod-marca').value.trim() || null,
    esImpulso: document.getElementById('prod-es-impulso')?.checked || false,
    tipo: document.getElementById('prod-tipo').value,
    unidad: document.getElementById('prod-unidad').value,
    costo, precio,
    stockMin: parseFloat(document.getElementById('prod-stock-min').value) || 5,
    venc: document.getElementById('prod-venc').value,
    codigo: document.getElementById('prod-codigo').value || '7' + getId().toString().slice(-12),
    // provs: arreglo — un producto puede conseguirse de varios proveedores distintos (cercanía
    // de reparto, fecha, precio del momento). Reemplaza al viejo campo `prov` (un solo id) ver
    // _provsDeProducto() más arriba para la compatibilidad con productos ya guardados.
    provs: Array.from(document.querySelectorAll('#prod-prov-lista input[type="checkbox"]:checked')).map(chk => parseInt(chk.value)).filter(n => !isNaN(n)),
    imagen: document.getElementById('prod-img-data').value || '',
    tieneDetalle
  };

  if (existente) {
    // Fase 6: el stock NUNCA se toca desde este formulario al editar — se preserva tal cual.
    // Cambios de stock van por boleta (compra), merma (pérdida) o inventario mensual (conteo físico),
    // así queda auditado — no un número que se pisa a mano.
    prod.stock = existente.stock;
    const idx = DB.productos.findIndex(p => p.id === editingProductId);
    DB.productos[idx] = prod;
  } else {
    // Nuevo producto: el stock inicial ingresado se aplica via ajustarStockSede() (no
    // asignación directa) para que también sincronice a Firestore.
    const stockRaw = parseFloat(document.getElementById('prod-stock').value);
    const stockInicial = isNaN(stockRaw) ? 0 : Math.round(stockRaw * 1000) / 1000;
    prod.stock = 0;
    DB.productos.push(prod);
    if (stockInicial > 0) ajustarStockSede(prod, stockInicial);
  }
  fbGuardarProducto(prod.id);

  // Detalle: colección aparte (productos_detalle) — solo se escribe/lee si el producto la usa.
  if (tieneDetalle) {
    const tieneMayor = document.getElementById('prod-tiene-mayor')?.checked || false;
    const detalle = {
      descripcion: document.getElementById('prod-desc-extendida')?.value.trim() || '',
      imagenesExtra: [document.getElementById('prod-img-extra-1-data')?.value, document.getElementById('prod-img-extra-2-data')?.value].filter(Boolean),
      precioMayor: tieneMayor ? {
        cantidadMin: parseFloat(document.getElementById('prod-mayor-cant')?.value) || 0,
        precio: parseFloat(document.getElementById('prod-mayor-precio')?.value) || 0
      } : null
    };
    fbGuardarDetalleProducto(prod.id, detalle);
  } else if (existente && existente.tieneDetalle) {
    // Se desactivó — limpia el registro huérfano, no lo deja abandonado.
    fbBorrarDetalleProducto(prod.id);
  }

  cerrarModal('modal-producto');
  renderInvTable();
  updateAlertCount();
  try { renderDashboard(); } catch(e){}
  try { renderPos(); } catch(e){}
}

// ===================== CATEGORIAS =====================
// ===================== CATEGORIAS =====================
let editingCatId = null;

function onCatImgSelect(e) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede subir imágenes de categoría.'); return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      // Limite de resolucion para la foto de categoria. El circulo pequeño donde se ve
      // primero (64px en tienda publica) ya tenia sobra de resolucion con 600x400 — la causa
      // real de falta de detalle era otro uso: esta misma imagen sirve de respaldo en la
      // grilla de productos cuando un producto no tiene foto propia, donde una tarjeta puede
      // llegar a 250-300px CSS en pantallas anchas de escritorio, necesitando hasta 600-900px
      // reales en pantallas de alta densidad de pixeles para verse totalmente nitida.
      const MAX_W = 900, MAX_H = 600;
      const ratio = Math.min(MAX_W / img.width, MAX_H / img.height);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const previewData = canvas.toDataURL('image/webp', 0.80);
      const preview = document.getElementById('cat-img-preview');
      preview.innerHTML = `<img src="${previewData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
      if (!storageModular) { document.getElementById('cat-img-data').value = previewData; return; }
      const lbl = document.createElement('small');
      lbl.id = '_cat-img-lbl'; lbl.style = 'color:var(--primary);font-size:.72rem';
      lbl.textContent = '⏳ Subiendo...';
      preview.parentNode.appendChild(lbl);
      const _btnGuardarCat = document.querySelector('#modal-categoria .btn-primary');
      if (_btnGuardarCat) _btnGuardarCat.disabled = true;
      canvas.toBlob(async (blob) => {
        try {
          const ref = refM(storageModular, `categorias/${editingCatId || Date.now()}.webp`);
          await uploadBytesM(ref, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=2592000' });
          const url = await getDownloadURLM(ref);
          document.getElementById('cat-img-data').value = url;
          const l = document.getElementById('_cat-img-lbl'); if (l) l.remove();
        } catch(err) {
          document.getElementById('cat-img-data').value = previewData;
          const l = document.getElementById('_cat-img-lbl');
          if (l) l.textContent = '⚠️ Error — imagen guardada local';
        } finally {
          if (_btnGuardarCat) _btnGuardarCat.disabled = false;
        }
      }, 'image/webp', 0.80);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function limpiarImgCat() {
  document.getElementById('cat-img-data').value = '';
  document.getElementById('cat-img-file').value = '';
  const p = document.getElementById('cat-img-preview');
  if (p) { p.innerHTML = '🖼️'; p.style.fontSize='1.8rem'; }
}

function _setCatImgPreview(img) {
  const p = document.getElementById('cat-img-preview');
  if (!p) return;
  if (img) {
    p.innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
  } else {
    p.innerHTML = '🖼️'; p.style.fontSize = '1.8rem';
  }
}

function renderCategorias() {
  document.getElementById('cats-grid').innerHTML = DB.categorias.map(c => `
    <div class="card" style="text-align:center;position:relative">
      ${c.oculta ? `<div class="badge badge-orange" style="position:absolute;top:.6rem;right:.6rem">🚧 Oculta</div>` : ''}
      <div style="width:56px;height:56px;margin:0 auto .5rem;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--gray-100);font-size:2rem">
        ${c.imagen ? `<img src="${c.imagen}" style="width:100%;height:100%;object-fit:cover"/>` : (c.emoji || '📦')}
      </div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:0.25rem">${c.nombre}</div>
      <div class="badge badge-purple" style="margin-bottom:.3rem">Margen: ${c.margen||0}%</div>
      <div style="font-size:0.8rem;color:var(--gray-500);margin-bottom:0.75rem">${DB.productos.filter(p=>p.cat==c.id).length} productos</div>
      <div style="display:flex;gap:.4rem;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-outline btn-xs" onclick="editarCategoria(${c.id})">✏️ Editar</button>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarCategoria(${c.id})">🗑️</button>
      </div>
    </div>`).join('');
}

function abrirModalCategoria() {
  editingCatId = null;
  document.getElementById('cat-modal-titulo').textContent = 'Nueva Categoría';
  document.getElementById('cat-nombre').value = '';
  document.getElementById('cat-emoji').value = '';
  document.getElementById('cat-margen').value = '';
  document.getElementById('cat-img-data').value = '';
  document.getElementById('cat-img-file').value = '';
  const _catOcultaChk2 = document.getElementById('cat-oculta'); if (_catOcultaChk2) _catOcultaChk2.checked = false;
  _setCatImgPreview(null);
  document.getElementById('cat-update-prods-wrap').style.display = 'none';
  abrirModal('modal-categoria');
}

function editarCategoria(id) {
  editingCatId = id;
  const c = DB.categorias.find(x => x.id === id);
  document.getElementById('cat-modal-titulo').textContent = 'Editar Categoría: ' + c.nombre;
  document.getElementById('cat-nombre').value = c.nombre;
  document.getElementById('cat-emoji').value = c.emoji || '';
  document.getElementById('cat-margen').value = c.margen || 0;
  document.getElementById('cat-img-data').value = c.imagen || '';
  document.getElementById('cat-img-file').value = '';
  const _catOcultaChk = document.getElementById('cat-oculta'); if (_catOcultaChk) _catOcultaChk.checked = !!c.oculta;
  _setCatImgPreview(c.imagen || null);
  const nProds = DB.productos.filter(p => p.cat == id).length;
  document.getElementById('cat-update-prods-wrap').style.display = nProds > 0 ? 'block' : 'none';
  abrirModal('modal-categoria');
}

function abrirImprimirQrMasivo() {
  // Build modal dynamically
  let m = document.getElementById('modal-qr-masivo');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-qr-masivo';
    m.className = 'modal-overlay';
    document.body.appendChild(m);
  }
  const cats = DB.categorias.map(c => `<option value="${c.id}">${c.imagen?'🖼':c.emoji} ${c.nombre}</option>`).join('');
  m.innerHTML = `
  <div class="modal" style="max-width:620px;width:96vw">
    <div class="modal-header">
      <h3>🖨️ Impresión masiva de QR</h3>
      <button class="modal-close" onclick="cerrarModal('modal-qr-masivo')">✕</button>
    </div>
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:.75rem">
      <div style="flex:1;min-width:160px">
        <label style="font-size:.8rem;font-weight:600">Categoría</label>
        <select class="form-control" id="qrm-cat" onchange="renderQrMasivoLista()">
          <option value="">Todas</option>${cats}
        </select>
      </div>
      <div style="flex:1;min-width:160px">
        <label style="font-size:.8rem;font-weight:600">Buscar producto</label>
        <input type="text" class="form-control" id="qrm-buscar" placeholder="Nombre o código..." oninput="renderQrMasivoLista()"/>
      </div>
      <div style="flex:0 0 auto;min-width:140px">
        <label style="font-size:.8rem;font-weight:600">Layout</label>
        <select class="form-control" id="qrm-layout">
          <option value="4">4 columnas</option>
          <option value="3">3 columnas</option>
          <option value="2">2 columnas grandes</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;margin-bottom:.6rem;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="qrmSelAll(true)">☑ Todos</button>
      <button class="btn btn-outline btn-sm" onclick="qrmSelAll(false)">☐ Ninguno</button>
      <span id="qrm-count" style="font-size:.78rem;color:var(--gray-500);margin-left:.5rem"></span>
      <div style="flex:1"></div>
      <button class="btn btn-primary btn-sm" onclick="imprimirQrsMasivos()">🖨️ Imprimir seleccionados</button>
    </div>
    <div id="qrm-lista" style="max-height:340px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;padding:.5rem"></div>
  </div>`;
  abrirModal('modal-qr-masivo');
  renderQrMasivoLista();
}

function renderQrMasivoLista() {
  const catFil = document.getElementById('qrm-cat')?.value;
  const buscar = (document.getElementById('qrm-buscar')?.value || '').toLowerCase();
  let prods = DB.productos.filter(p =>
    (!catFil || p.cat == catFil) &&
  (!buscar || _norm(p.nombre).includes(_norm(buscar)) || _norm(p.codigo||'').includes(_norm(buscar)))
  );
  const el = document.getElementById('qrm-lista');
  if (!el) return;
  el.innerHTML = prods.map(p => {
    const cat = DB.categorias.find(c => c.id == p.cat);
    return `<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;border-bottom:1px solid var(--gray-100)">
      <input type="checkbox" class="qrm-chk" data-id="${p.id}" checked style="width:18px;height:18px;cursor:pointer" onchange="qrmUpdateCount()"/>
      <span style="font-size:1.1rem">${cat?.imagen?`<img src="${cat.imagen}" style="width:20px;height:20px;object-fit:cover;border-radius:3px;vertical-align:middle"/>`:(cat?.emoji||'📦')}</span>
      <span style="flex:1;font-size:.85rem;font-weight:600">${p.nombre}</span>
      <span style="font-size:.72rem;color:var(--gray-400)">${p.codigo||'—'}</span>
    </div>`;
  }).join('') || '<div style="padding:1rem;text-align:center;color:var(--gray-400)">Sin productos</div>';
  qrmUpdateCount();
}

function qrmSelAll(v) {
  document.querySelectorAll('.qrm-chk').forEach(c => c.checked = v);
  qrmUpdateCount();
}

function qrmUpdateCount() {
  const n = document.querySelectorAll('.qrm-chk:checked').length;
  const el = document.getElementById('qrm-count');
  if (el) el.textContent = `${n} seleccionado${n!==1?'s':''}`;
}

function imprimirQrsMasivos() {
  const ids = [...document.querySelectorAll('.qrm-chk:checked')].map(c => parseInt(c.dataset.id));
  if (!ids.length) { alert('Selecciona al menos un producto'); return; }
  const prods = ids.map(id => DB.productos.find(p => p.id === id)).filter(Boolean);
  const n = prods.length;
  const w = window.open('','_blank','width=900,height=700');

  // Tamaño FIJO independiente de cantidad — consistencia de etiquetas
  const COLS   = 4;
 const LBL_W  = 160;
  const BC_H   = 60;
  const BC_W   = 1.2;
  const F_NAME = 14;
  const F_PRICE= 14;
  const NAME_H = 36;
  const F_CODE = 10;

  const rows = prods.map((p, i) => {
    const codigo = p.codigo || String(p.id);
    return `<div id="bc-wrap-${i}" style="display:inline-block;width:${LBL_W}px;margin:6px;text-align:center;border:1px solid #ddd;border-radius:6px;padding:8px 6px;page-break-inside:avoid;vertical-align:top;box-sizing:border-box;overflow:hidden">
     <div style="width:100%;overflow:hidden;margin-bottom:4px"><svg id="bc-${i}" style="display:block;margin:0 auto;width:100%;max-width:${LBL_W-12}px"></svg></div>
    <div style="font-size:${F_NAME}px;font-weight:700;line-height:1.3;height:${NAME_H}px;overflow:hidden;margin-bottom:3px;word-break:break-word;overflow-wrap:break-word">${p.nombre}</div>
      <div style="font-size:${F_PRICE}px;font-weight:800;color:#6c3fff">S/ ${p.precio.toFixed(2)}</div>
    </div>`;
  }).join('');

  w.document.write(`<!DOCTYPE html><html><head><title>Códigos de barra — ${DB.config.nombre||'Minimarket'}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 10px; margin: 0; }
    @media print { .no-print { display:none!important } }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.6/JsBarcode.all.min.js" onerror="var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';document.head.appendChild(s);"><\/script>
  </head><body>
  <div class="no-print" style="text-align:center;margin-bottom:10px;padding:8px;background:#f9f9f9;border-bottom:1px solid #eee">
    <button onclick="window.print()" style="background:#6c3fff;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Imprimir</button>
    <button onclick="window.close()" style="background:#eee;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin-left:8px">✕ Cerrar</button>
    <span style="font-size:12px;color:#666;margin-left:12px">${n} etiqueta${n!==1?'s':''} — ${DB.config.nombre||'Minimarket'}</span>
  </div>
  <div style="text-align:left;padding:4px">${rows}</div>
  <script>
    var items = ${JSON.stringify(prods.map((p,i) => ({ i, codigo: p.codigo || String(p.id) })))};
    function renderBarcodes() {
      items.forEach(function(item) {
        try {
          JsBarcode('#bc-' + item.i, item.codigo, {
            format: 'CODE128',
            width: ${BC_W},
            height: ${BC_H},
            displayValue: true,
            fontSize: ${F_CODE},
            margin: 4,
            textMargin: 2
          });
        } catch(e) {
          var el = document.getElementById('bc-' + item.i);
          if (el) el.outerHTML = '<div style="font-size:10px;color:#999;padding:8px 0;word-break:break-all">' + item.codigo + '</div>';
        }
      });
    }
    if (typeof JsBarcode !== 'undefined') { renderBarcodes(); }
    else { window.addEventListener('load', function(){ if(typeof JsBarcode!=='undefined') renderBarcodes(); }); }
  <\/script>
  </body></html>`);
  w.document.close();
}

function actualizarPreciosCat(modo) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede actualizar precios por categoría.'); return; }
  if (!editingCatId) return;
  const cat = DB.categorias.find(c => c.id === editingCatId);
  const prods = DB.productos.filter(p => p.cat == editingCatId);
  if (!cat.margen) { alert('Define primero el margen de esta categoría'); return; }

  if (modo === 'todos') {
    let actualizados = 0;
    prods.forEach(p => {
      const nuevo = Math.ceil(p.costo * (1 + cat.margen/100) * 10) / 10;
      p.precio = nuevo;
      actualizados++;
    });
    fbGuardarProductosLote(prods.map(p => p.id));
    cerrarModal('modal-categoria');
    renderCategorias();
    renderInvTable();
    alert(`✅ Precios actualizados en ${actualizados} productos de "${cat.nombre}" con margen ${cat.margen}%`);
  } else {
    // Individual
    document.getElementById('cup-titulo').textContent = 'Actualizar precios — ' + cat.nombre + ' (' + cat.margen + '%)';
    document.getElementById('cup-tbody').innerHTML = prods.map(p => {
      const nuevo = Math.ceil(p.costo * (1 + cat.margen/100) * 10) / 10;
      const cambio = nuevo !== p.precio;
      return `<tr>
        <td><strong>${p.nombre}</strong></td>
        <td>${sol(p.costo)}</td>
        <td style="color:${cambio?'var(--warning)':'inherit'}">${sol(p.precio)}</td>
        <td style="color:var(--accent);font-weight:700">${sol(nuevo)}</td>
        <td><input type="checkbox" id="cup-chk-${p.id}" ${cambio?'checked':''} style="width:18px;height:18px;cursor:pointer" /></td>
      </tr>`;
    }).join('');
    abrirModal('modal-cat-update-precios');
  }
}

function aplicarPreciosCatSeleccionados() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede aplicar precios seleccionados.'); return; }
  if (!editingCatId) return;
  const cat = DB.categorias.find(c => c.id === editingCatId);
  const prods = DB.productos.filter(p => p.cat == editingCatId);
  let n = 0;
  const _idsModificados = [];
  prods.forEach(p => {
    const chk = document.getElementById('cup-chk-' + p.id);
    if (chk && chk.checked) {
      p.precio = Math.ceil(p.costo * (1 + cat.margen/100) * 10) / 10;
      n++;
      _idsModificados.push(p.id);
    }
  });
  fbGuardarProductosLote(_idsModificados);
  cerrarModal('modal-cat-update-precios');
  cerrarModal('modal-categoria');
  renderInvTable();
  alert(`✅ ${n} precio(s) actualizado(s)`);
}

function eliminarCategoria(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar categorías.'); return; }
  if (DB.productos.some(p => p.cat == id)) { alert('No puedes eliminar una categoría con productos asignados'); return; }
  if (!confirm('¿Eliminar esta categoría?')) return;
  DB.categorias = DB.categorias.filter(c => c.id !== id); fbGuardarProductos('categorias');
  renderCategorias();
}

// ===================== ESCÁNER html5-qrcode =====================
let html5QrScanner = null;
let scannerModo    = 'pos'; // 'pos' | 'inventario'
let _scannerCooldown = false; // evita disparos dobles

function setStatusScanner(msg, tipo) {
  const el = document.getElementById('scanner-status');
  if (!el) return;
  const colores = {
    ok:    'background:var(--accent-light);color:var(--accent-dark)',
    error: 'background:var(--danger-light);color:var(--danger)',
    info:  'background:var(--info-light);color:var(--info)',
    warn:  'background:var(--warning-light);color:var(--warning)'
  };
  el.style.cssText = `text-align:center;padding:0.5rem;font-size:0.82rem;border-radius:8px;margin-bottom:0.75rem;${colores[tipo]||colores.info}`;
  el.textContent = msg;
}

// ── Scanner: completamente independiente del sistema de modales ─────────────
function _showScannerOverlay() {
  const overlay = document.getElementById('modal-scanner');
  if (!overlay) return;
  // Inline styles sobreescriben CUALQUIER CSS global (mayor especificidad)
  overlay.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:0',
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'background:rgba(0,0,0,0.82)'
  ].join(';');
  const modal = overlay.querySelector('.modal');
  if (modal) {
    modal.style.cssText = [
      'position:relative',
      'width:88vw',
      'max-width:520px',
      'height:75dvh',
      'max-height:600px',
      'border-radius:16px',
      'padding:1rem',
      'overflow:hidden',
      'margin:0',
      'transform:none',
      'top:auto',
      'left:auto',
      'background:white',
      'display:flex',
      'flex-direction:column'
    ].join(';');
  }
  overlay.classList.add('open');
}

function _hideScannerOverlay() {
  const overlay = document.getElementById('modal-scanner');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.style.cssText = '';
  const modal = overlay.querySelector('.modal');
  if (modal) modal.style.cssText = '';
}

function openCamScanner() {
  if (!window.Html5Qrcode) { _loadHtml5QrCode(function(){ openCamScanner(); }); return; }
  scannerModo = 'pos';
  document.getElementById('scanner-titulo').textContent = '📷 Escanear producto';
  document.getElementById('scanner-manual').value = '';
  document.getElementById('scanner-resultado').style.display = 'none';
  _showScannerOverlay();
  _iniciarHtml5Qr();
}

// Abrir escáner desde modal de producto (inventario)
function abrirScannerInventario() {
  if (!window.Html5Qrcode) { _loadHtml5QrCode(function(){ abrirScannerInventario(); }); return; }
  scannerModo = 'inventario';
  _showScannerOverlay(); // independiente del sistema de modales
  document.getElementById('scanner-titulo').textContent = '📷 Escanear código del producto';
  document.getElementById('scanner-manual').value = '';
  document.getElementById('scanner-resultado').style.display = 'none';
  _iniciarHtml5Qr(); // _showScannerOverlay ya fue llamado antes
}

function _iniciarHtml5Qr() {
  _scannerCooldown = false;
  setStatusScanner('🔄 Iniciando cámara...', 'info');

  if (typeof Html5Qrcode === 'undefined') {
    setStatusScanner('⚠️ Librería no cargada — usa entrada manual abajo', 'warn');
    return;
  }

  // Detener instancia previa si existiera
  _detenerHtml5Qr().then(() => {
    const config = {
      fps: 12,
      qrbox: { width: 250, height: 180 },
      aspectRatio: 1.4,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX
      ]
    };

    html5QrScanner = new Html5Qrcode('html5-qrcode-reader', { verbose: false });

    // Preferir cámara trasera automáticamente
    html5QrScanner.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => { manejarCodigoDetectado(decodedText); },
      () => {} // errores de frame ignorados (normales entre lecturas)
    ).then(() => {
      setStatusScanner('📷 Apunta al código del producto...', 'info');
    }).catch(err => {
      // Si environment falla, intentar con cualquier cámara disponible
      if (html5QrScanner) {
        html5QrScanner.start(
          { facingMode: 'user' },
          config,
          (decodedText) => { manejarCodigoDetectado(decodedText); },
          () => {}
        ).then(() => {
          setStatusScanner('📷 Cámara activa — apunta al código...', 'info');
        }).catch(() => {
          setStatusScanner('❌ Permiso de cámara denegado — actívalo en ajustes del navegador o usa entrada manual', 'error');
        });
      }
    });
  });
}

function _detenerHtml5Qr() {
  if (!html5QrScanner) return Promise.resolve();
  return html5QrScanner.stop().catch(() => {}).finally(() => {
    // Limpiar el contenedor para re-uso limpio
    try { html5QrScanner.clear(); } catch(e) {}
    html5QrScanner = null;
  });
}

function manejarCodigoDetectado(codigo) {
  if (!codigo || _scannerCooldown) return;
  _scannerCooldown = true; // bloquear re-disparos hasta procesar

  // Vibrar si disponible
  if (navigator.vibrate) navigator.vibrate(100);

  // Mostrar resultado visual
  document.getElementById('scanner-resultado').style.display = 'block';
  document.getElementById('scanner-codigo-detectado').textContent = codigo;

  if (scannerModo === 'pos') {
    const prod = DB.productos.find(p => p.codigo === codigo);
    if (prod) {
      document.getElementById('scanner-prod-nombre').textContent = '✅ ' + prod.nombre + ' — ' + sol(prod.precio);
      setStatusScanner('✅ Producto encontrado: ' + prod.nombre, 'ok');
      setTimeout(() => {
        if (window.innerWidth <= 900) {
          mobAddToCart(prod.id);
        } else {
          addToCart(prod.id);
        }
        cerrarScanner();
      }, 700);
    } else {
      document.getElementById('scanner-prod-nombre').textContent = '⚠️ Código no registrado en inventario';
      setStatusScanner('⚠️ Código ' + codigo + ' no encontrado — agrégalo al inventario primero', 'warn');
      document.getElementById('scanner-manual').value = codigo;
      // Reactivar lectura tras 2s para seguir buscando
      setTimeout(() => { _scannerCooldown = false; }, 2000);
    }

  } else if (scannerModo === 'inventario') {
    const existe = DB.productos.find(p => p.codigo === codigo);
    if (existe) {
      // Producto ya registrado — pre-rellenar formulario con sus datos
      document.getElementById('scanner-prod-nombre').textContent = '✅ Código encontrado: ' + existe.nombre;
      setStatusScanner('✅ Producto existente detectado — cargando datos...', 'ok');
      setTimeout(() => {
        cerrarScanner();
        // Abrir el modal con los datos del producto existente para editar/confirmar
        editarProducto(existe.id);
      }, 700);
    } else {
      // Producto nuevo — solo pasar el código al campo
      document.getElementById('scanner-prod-nombre').textContent = '✅ Código capturado — completa los datos del producto';
      setStatusScanner('✅ Código escaneado — rellena el formulario', 'ok');
      setTimeout(() => {
        cerrarScanner();
        document.getElementById('prod-codigo').value = codigo;
        previsualizarCodigo();
      }, 700);
    }
  }
}

function procesarCodigoEscaneado(codigo) {
  if (!codigo) { alert('Ingresa un código'); return; }
  manejarCodigoDetectado(codigo);
}

function cerrarScanner() {
  _detenerHtml5Qr().catch(() => {});
  document.getElementById('scanner-resultado').style.display = 'none';
  _hideScannerOverlay(); // NO usa cerrarModal — completamente independiente
}

// Mantener compatibilidad con llamadas antiguas
// ===================== INVENTARIO MENSUAL =====================
let invMensualData = [];

function abrirInventarioMensual() {
  document.getElementById('inv-mens-fecha').value = today();
  invMensualData = DB.productos.map(p => ({ prodId: p.id, contado: null, verificado: false, motivo: '' }));
  renderInvMensualTable();
  const _catSel = document.getElementById('inv-mens-cat');
  if (_catSel) {
    _catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      (DB.categorias||[]).map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
  const _buscarEl = document.getElementById('inv-mens-buscar');
  if (_buscarEl) _buscarEl.value = '';
  const _soloSinVerif = document.getElementById('inv-mens-solo-sin-verificar');
  if (_soloSinVerif) _soloSinVerif.checked = false;
  abrirModal('modal-inv-mensual');
}

// Filtro puramente visual — oculta/muestra filas ya renderizadas segun busqueda, categoria y
// estado de verificacion. NUNCA reordena ni reconstruye la tabla, ni toca invMensualData —
// cada fila conserva su data-idx original, que es lo unico que guardarInventarioMensual()
// usa realmente para saber a que producto corresponde cada dato.
function filtrarInvMensualTabla() {
  const _texto = (document.getElementById('inv-mens-buscar')?.value || '').trim().toLowerCase();
  const _catId = document.getElementById('inv-mens-cat')?.value || '';
  const _soloSinVerificar = document.getElementById('inv-mens-solo-sin-verificar')?.checked || false;
  document.querySelectorAll('#inv-mens-tbody tr[data-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.idx);
    const p = DB.productos[idx];
    const d = invMensualData[idx];
    if (!p) { tr.style.display = 'none'; return; }
    let visible = true;
    if (_texto && !p.nombre.toLowerCase().includes(_texto)) visible = false;
    if (_catId && String(p.cat) !== _catId) visible = false;
    if (_soloSinVerificar && d?.verificado) visible = false;
    tr.style.display = visible ? '' : 'none';
  });
}

function renderInvMensualTable() {
  document.getElementById('inv-mens-tbody').innerHTML = DB.productos.map((p, i) => {
    const d = invMensualData[i] || {};
    const _stockAqui = stockEnSede(p);
    const diff = d.contado !== null && d.contado !== '' ? parseFloat(d.contado) - _stockAqui : null;
    const diffColor = diff === null ? '' : diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--warning)' : 'var(--accent)';
    const rowBg = d.verificado ? (diff === 0 || diff === null ? 'background:var(--accent-light)' : 'background:var(--danger-light)') : '';
    return `<tr data-idx="${i}" style="${rowBg}">
      <td><strong>${p.nombre}</strong></td>
      <td style="font-size:.78rem">${getCategoriaNombre(p.cat)}</td>
      <td><strong>${_stockAqui} ${p.unidad}</strong></td>
      <td>
        <input type="number" step="0.01" value="${d.contado !== null ? d.contado : ''}"
          placeholder="Cantidad física"
          style="width:100px;padding:.3rem .5rem;border:1.5px solid var(--gray-200);border-radius:6px;font-size:.82rem"
          oninput="actualizarInvMensual(${i}, 'contado', this.value); this.closest('tr').cells[4].innerHTML=calcDiffCell(${i})" />
      </td>
      <td id="diff-cell-${i}" style="font-weight:700;color:${diffColor}">
        ${diff !== null ? (diff > 0 ? '+'+diff.toFixed(2) : diff.toFixed(2)) : '-'}
      </td>
      <td>
        <select style="padding:.3rem .5rem;border:1.5px solid var(--gray-200);border-radius:6px;font-size:.78rem"
          onchange="actualizarInvMensual(${i}, 'motivo', this.value)">
          <option value="">Sin motivo</option>
          <option value="Vencido">Vencido</option>
          <option value="Dañado">Dañado</option>
          <option value="Robo">Robo/Pérdida</option>
          <option value="Error de conteo">Error de conteo</option>
          <option value="Otro">Otro</option>
        </select>
      </td>
      <td style="text-align:center">
        <input type="checkbox" ${d.verificado?'checked':''} onchange="actualizarInvMensual(${i}, 'verificado', this.checked)"
          style="width:18px;height:18px;cursor:pointer" />
      </td>
    </tr>`;
  }).join('');
}

function calcDiffCell(i) {
  const p = DB.productos[i];
  const d = invMensualData[i];
  if (d.contado === null || d.contado === '') return '-';
  const diff = parseFloat(d.contado) - stockEnSede(p);
  const color = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--warning)' : 'var(--accent)';
  return `<span style="color:${color};font-weight:700">${diff > 0 ? '+' : ''}${diff.toFixed(2)}</span>`;
}

function actualizarInvMensual(i, campo, valor) {
  if (!invMensualData[i]) return;
  if (campo === 'contado') invMensualData[i].contado = valor === '' ? null : parseFloat(valor);
  else if (campo === 'verificado') invMensualData[i].verificado = valor;
  else if (campo === 'motivo') invMensualData[i].motivo = valor;
  // Actualizar celda de diferencia
  const p = DB.productos[i];
  const d = invMensualData[i];
  const cell = document.getElementById('diff-cell-' + i);
  if (cell && d.contado !== null) {
    const diff = d.contado - stockEnSede(p);
    const color = diff < 0 ? 'var(--danger)' : diff > 0 ? 'var(--warning)' : 'var(--accent)';
    cell.style.color = color;
    cell.textContent = (diff > 0 ? '+' : '') + diff.toFixed(2);
  }
  // Efecto puramente visual: si el filtro "solo sin verificar" esta activo, la fila
  // desaparece al marcarse como verificada — no toca ningun dato, solo re-aplica el filtro ya vigente.
  if (campo === 'verificado' && typeof filtrarInvMensualTabla === 'function') filtrarInvMensualTabla();
}

async function sincronizarMermasInventario() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede sincronizar mermas de inventario.'); return; }
  const sede = sedeAdminEfectiva();
  const fechaInv = document.getElementById('inv-mens-fecha').value || today();
  const _pendientes = []; // {prod, cantidad, mermaObj}

  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  // CRITICO: el diff se calcula contra el valor REAL y fresco de Firestore (getDocFromServer,
  // nunca cache), no contra la pantalla — un conteo fisico declara la verdad de lo que hay en
  // el local, y el ajuste nunca debe depender de que la pantalla tenga razon en ese momento.
  for (let i = 0; i < invMensualData.length; i++) {
    const d = invMensualData[i];
    if (d.contado === null || d.contado === '' || !d.verificado) continue;
    const p = DB.productos.find(prod => prod.id === invMensualData[i].prodId) || DB.productos[i];
    if (!p) continue;
    let _stockReal = stockEnSede(p);
    try {
      const snapFresco = await getDocDelServidorM(docM(dbModular, 'productos', String(p.id)));
      if (snapFresco.exists()) _stockReal = snapFresco.data().stock || 0;
    } catch (e) {
      console.warn('No se pudo leer el stock real fresco de ' + p.nombre + ', usando el valor local:', e);
    }
    const diff = Math.round((d.contado - _stockReal) * 1000) / 1000;
    if (diff < 0) {
      const cantidad = Math.abs(diff);
      const _mermaInv = {
        id: getId(), prodId: p.id, cant: cantidad,
        motivo: d.motivo || 'Inventario mensual',
        obs: 'Registrado desde inventario mensual ' + formatDate(fechaInv),
        fecha: fechaInv, usuario: currentUser, sedeId: sede, costoUnitario: p.costo
      };
      _pendientes.push({ prod: p, delta: diff, merma: _mermaInv }); // diff ya es negativo
    }
  }

  if (_pendientes.length === 0) {
    alert('No hay diferencias negativas verificadas para sincronizar.\nMarca el check ✅ en los productos con faltantes confirmados.');
    return;
  }

  // Paquete atomico: TODAS las mermas del conteo y sus ajustes de stock viajan juntos —
  // mismo criterio que guardarMerma(). Firestore permite maximo 500 operaciones por lote —
  // con 2 operaciones por producto (stock + merma), un conteo con mas de 250 diferencias
  // superaria ese limite y el lote fallaria entero sin necesidad. Se parte en bloques de 200
  // productos (400 operaciones) por seguridad, mismo criterio que ya usa el sistema de backups.
  const _CHUNK = 200;
  for (let i = 0; i < _pendientes.length; i += _CHUNK) {
    const trozo = _pendientes.slice(i, i + _CHUNK);
    const batch = writeBatchM(dbModular);
    trozo.forEach(({prod, delta, merma}) => {
      batch.set(docM(dbModular, 'productos', String(prod.id)),
        { stock: incrementM(delta) }, { merge: true });
      batch.set(docM(dbModular, 'mermas', String(merma.id)), merma);
    });

    _sincIniciar('inv_mensual_lote', fechaInv + '_' + i);
    try {
      await batch.commit();
      _sincTerminar('inv_mensual_lote', fechaInv + '_' + i);
    } catch (e) {
      _sincError('inv_mensual_lote', fechaInv + '_' + i, e,
        'la sincronización de inventario mensual — se aplicaron ' + i + ' de ' + _pendientes.length + ' diferencias antes del error');
      return;
    }
  }

  _pendientes.forEach(({prod, delta, merma}) => {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
    DB.mermas.push(merma);
  });
  fbGuardar();
  alert('✅ ' + _pendientes.length + ' diferencia(s) sincronizadas con mermas y stock actualizado.');
  updateAlertCount();
  // CRITICO: sin esto, el stock se actualizaba correctamente por dentro (memoria + Firestore)
  // pero la tabla en pantalla seguia mostrando los valores viejos — parecia que "no habia
  // pasado nada" hasta cerrar y reabrir la app, que es cuando recien se veia el cambio real.
  renderInvMensualTable();
}

// CRITICO: antes esta funcion solo guardaba un resumen historico del conteo, sin tocar el
// stock real para nada — el usuario esperaba que "Guardar" corrigiera el stock y no pasaba
// nada visible. La otra funcion que si tocaba stock (sincronizarMermasInventario) registraba
// TODA diferencia como una merma (perdida) y encima ignoraba por completo los sobrantes
// (diff > 0, como una carga inicial o un producto nuevo agregado sin pasar por boleta) — mal
// ajuste conceptual para casos que no son una perdida real: carga inicial del sistema,
// productos armados en casa sin compra a proveedor, correcciones puntuales de conteo. Ahora
// "Guardar inventario" ajusta el stock real directamente a la cantidad fisica contada (en
// cualquier direccion), SIN crear ninguna merma y SIN tocar caja/movimientos — el costo del
// producto (asignado al crearlo) sigue siendo lo que se descuenta al vender, asi que la
// rentabilidad real no se ve afectada por como llego el stock. sincronizarMermasInventario()
// sigue disponible aparte, intacta, para cuando si se quiera registrar una perdida real con
// motivo.
async function guardarInventarioMensual() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede guardar el inventario mensual.'); return; }
  const sede = sedeAdminEfectiva();
  const fecha = document.getElementById('inv-mens-fecha').value || today();

  // CRITICO: el delta (cuanto sumar o restar) se calcula contra el valor REAL y fresco de
  // Firestore (getDocFromServer, nunca cache), nunca contra lo que la pantalla tenia en
  // memoria en ese momento — un conteo fisico declara la verdad de lo que hay en el local, y
  // el ajuste nunca debe depender de que la pantalla tenga razon en ese momento.
  const _pendientes = []; // {prod, delta}
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  for (let i = 0; i < invMensualData.length; i++) {
    const d = invMensualData[i];
    const p = DB.productos.find(prod => prod.id === d.prodId) || DB.productos[i];
    if (!p) continue;
    if (d.contado === null || d.contado === '' || !d.verificado) continue;
    let _stockReal = stockEnSede(p); // valor local como respaldo si la lectura fresca falla
    try {
      const snapFresco = await getDocDelServidorM(docM(dbModular, 'productos', String(p.id)));
      if (snapFresco.exists()) _stockReal = snapFresco.data().stock || 0;
    } catch (e) {
      console.warn('No se pudo leer el stock real fresco de ' + p.nombre + ', usando el valor local:', e);
    }
    const _diff = Math.round((d.contado - _stockReal) * 1000) / 1000;
    if (_diff !== 0) _pendientes.push({ prod: p, delta: _diff });
  }

  if (_pendientes.length > 0) {
    const _CHUNK = 200;
    for (let i = 0; i < _pendientes.length; i += _CHUNK) {
      const trozo = _pendientes.slice(i, i + _CHUNK);
      const batch = writeBatchM(dbModular);
      trozo.forEach(({prod, delta}) => {
        batch.set(docM(dbModular, 'productos', String(prod.id)),
          { stock: incrementM(delta) }, { merge: true });
      });
      _sincIniciar('inv_mensual_stock_lote', fecha + '_' + i);
      try {
        await batch.commit();
        _sincTerminar('inv_mensual_stock_lote', fecha + '_' + i);
      } catch (e) {
        _sincError('inv_mensual_stock_lote', fecha + '_' + i, e,
          'la corrección de stock del inventario mensual — se aplicaron ' + i + ' de ' + _pendientes.length + ' correcciones antes del error');
        return;
      }
    }
    _pendientes.forEach(({prod, delta}) => {
      prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
    });
  }

  // CRITICO: ya NO se guarda un registro historico permanente del conteo (antes se acumulaba
  // en DB_EXT.inventariosMensuales, dentro de db_ext) — con ~1000 productos por sesion, esto
  // hacia crecer ese documento sin limite hasta superar el tamaño maximo que Firestore permite
  // por documento, rompiendo el guardado de capital/sueldos/configuracion tambien (comparten
  // el mismo documento). El ajuste real de stock arriba queda exactamente igual — esto solo
  // deja de acumular un historial que nadie termina revisando.
  alert('✅ Inventario guardado. ' + (_pendientes.length > 0 ? _pendientes.length + ' producto(s) con stock corregido. ' : '') + 'Total ítems verificados: ' + invMensualData.filter(d=>d.verificado).length);
  updateAlertCount();
  renderInvMensualTable();
}

// Valorizacion completa: stock, costo y precio de venta actuales — responde "cuanto tengo
// invertido" en un solo vistazo.
function exportarValorizacionInventario() {
  const fecha = today();
  let csv = 'Producto;Categoria;Stock;Costo Unitario;Precio Venta Unitario;Valor Invertido (costo);Valor Venta Potencial\n';
  let totInvertido = 0, totVenta = 0, totStock = 0;
  DB.productos.forEach(p => {
    const total = stockTotal(p);
    const _cat = DB.categorias.find(c => c.id == p.cat);
    const _catNombre = _cat ? _cat.nombre : 'Sin cat.';
    const valInvertido = Math.round(total * p.costo * 100) / 100;
    const valVenta = Math.round(total * p.precio * 100) / 100;
    totInvertido += valInvertido; totVenta += valVenta; totStock += total;
    csv += '"' + p.nombre + '";"' + _catNombre + '";' + total + ';' + p.costo + ';' + p.precio + ';' + valInvertido + ';' + valVenta + '\n';
  });
  csv += '\n"TOTAL";"";' + totStock + ';;;' + (Math.round(totInvertido*100)/100) + ';' + (Math.round(totVenta*100)/100) + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'valorizacion-inventario-' + fecha + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function exportarInventarioMensual() {
  const fecha = document.getElementById('inv-mens-fecha').value || today();
 let csv = 'Producto;Categoría;Tipo;Stock Sistema (esta sede);Cantidad Contada;Diferencia;Motivo;Verificado;Fecha Inventario\n';
  DB.productos.forEach((p, i) => {
    const d = invMensualData[i] || {};
    const _stockAqui = stockEnSede(p);
 const diff = d.contado !== null && d.contado !== undefined ? (d.contado - _stockAqui).toFixed(2) : '';
    const _cat = DB.categorias.find(c => c.id == p.cat);
    const _catNombre = _cat ? _cat.nombre : 'Sin cat.';
   csv += `"${p.nombre}";"${_catNombre}";"${p.tipo}";${_stockAqui};${d.contado??''};${diff};"${d.motivo||''}";"${d.verificado?'Sí':'No'}";"${formatDate(fecha)}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'inventario-mensual-' + fecha + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// Sugerir precios masivo
function abrirSugerirPrecios() {
  const tbody = document.getElementById('sug-tbody');
  const sugData = DB.productos.map(p => {
    const cat = DB.categorias.find(c => c.id == p.cat);
    const sug = cat && cat.margen ? Math.ceil(p.costo*(1+cat.margen/100)*10)/10 : p.precio;
    return { ...p, sug, cat };
  });
  tbody.innerHTML = sugData.map((p, i) => `
    <tr>
      <td>${p.nombre}</td>
      <td>${p.cat ? p.cat.emoji+' '+p.cat.nombre : '-'}</td>
      <td>${sol(p.costo)}</td>
      <td>${p.cat ? p.cat.margen+'%' : '-'}</td>
      <td><input type="number" value="${p.sug.toFixed(2)}" step="0.01" id="sg-${i}" style="width:80px;padding:4px;border:1px solid var(--gray-200);border-radius:6px" /></td>
      <td style="color:${p.sug!==p.precio?'var(--warning)':'inherit'}">${sol(p.precio)}</td>
      <td><button class="btn btn-accent btn-xs" onclick="aplicarSug(${i},${p.id})">Aplicar</button></td>
    </tr>`).join('');
  window._sugData = sugData;
  abrirModal('modal-sugerir-precios');
}

// FIX: botón Aplicar individual — con feedback visual
function aplicarSug(i, id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede aplicar sugerencias de precio.'); return; }
  const input = document.getElementById('sg-' + i);
  if (!input) return;
  const v = parseFloat(input.value);
  if (isNaN(v) || v <= 0) { alert('Ingresa un precio válido'); return; }
  const p = DB.productos.find(x => x.id === id);
  if (p) {
    p.precio = v;
    fbGuardarProducto(id);
    const row = input.closest('tr');
    if (row) {
      const btn = row.querySelector('button');
      if (btn) { btn.textContent = '✅ Aplicado'; btn.style.background = 'var(--accent)'; btn.style.color='white'; btn.disabled = true; }
      const celdaActual = row.cells[5];
      if (celdaActual) { celdaActual.textContent = sol(v); celdaActual.style.color = 'var(--accent)'; celdaActual.style.fontWeight='700'; }
    }
    renderInvTable();
  }
}

function aplicarTodosPrecios() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede aplicar todos los precios.'); return; }
  if (!window._sugData) return;
  const _idsAplicados = [];
  window._sugData.forEach((sd, i) => {
    const v = parseFloat(document.getElementById('sg-' + i)?.value);
    if (!isNaN(v) && v > 0) { const p = DB.productos.find(x => x.id===sd.id); if(p) { p.precio = v; _idsAplicados.push(p.id); } }
  });
  cerrarModal('modal-sugerir-precios');
  fbGuardarProductosLote(_idsAplicados);
  renderInvTable();
  alert('✅ Todos los precios actualizados');
}
