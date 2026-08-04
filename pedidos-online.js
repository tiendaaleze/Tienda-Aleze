// ===================== PEDIDOS ONLINE =====================
// ── Listener en tiempo real de colección pedidos_online ──────────────────────
// Se activa cuando el admin inicia sesión — mantiene DB.pedidosOnline sincronizado
// sin necesidad de recargar la página cuando llegan nuevos pedidos
// ── Notificaciones de pedidos online ──────────────────────────
// Solo muestra notificación cuando llega un pedido nuevo pendiente.
// No toca lógica de ventas, dashboard ni sincronización.
let _pedidosKnownIds = new Set(); // IDs ya vistos en esta sesión
let _pedidosLoaded   = false;       // true tras la primera carga — evita notificar al iniciar

function notificarNuevoPedido(pedido) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;
  const mostrar = () => {
    try {
      new Notification('🛍️ Nuevo pedido online', {
        body: `${pedido.clienteNombre || 'Cliente'} — S/ ${(pedido.total || 0).toFixed(2)}`,
        icon: '/Tienda-Aleze/icon.svg',
        tag: 'pedido-' + pedido.id, // evita duplicados
        requireInteraction: false
      });
    } catch(e) { console.warn('[Notif] Error:', e); }
  };
  if (Notification.permission === 'granted') {
    mostrar();
  } else {
    Notification.requestPermission().then(p => { if (p === 'granted') mostrar(); });
  }
}

function fbEscucharPedidosOnline() {
  if (!dbModular) return; // [SDK modular]
  // Limpiar listener previo si existe
  if (_pedidosOnlineUnsub) { _pedidosOnlineUnsub(); _pedidosOnlineUnsub = null; }

  _pedidosOnlineUnsub = onSnapshotM(
    queryM(collectionM(dbModular, 'pedidos_online'), orderByM('fecha', 'desc')),
    snapshot => {
if (_fbEscribiendo) return;
      if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
      if (_pedidosLoaded && Date.now() - _fbLastWriteTs < 2000) return;
      // Actualizar DB.pedidosOnline con todos los documentos de la colección
      const nuevos = snapshot.docs
        .map(doc => doc.data())
        .filter(p => p.estado === 'pendiente' && !_pedidosKnownIds.has(String(p.id)));
      DB.pedidosOnline = snapshot.docs.map(doc => doc.data());
      // Notificar pedidos nuevos SOLO después de la carga inicial
      if (_pedidosLoaded) {
        nuevos.forEach(p => { try { notificarNuevoPedido(p); } catch(e) {} });
      }
      // Registrar IDs conocidos para no re-notificar en siguientes snapshots
      DB.pedidosOnline.forEach(p => _pedidosKnownIds.add(String(p.id)));
      _pedidosLoaded = true;
      // Refrescar UI si el admin está viendo pedidos
      try { renderPedidosOnline(); } catch(e) {}
     // Actualizar badge de alertas (pedidos pendientes)
        try { updateAlertCount(); } catch(e) {}
        // Badge nav pedidos — visible para todos los roles
        try {
          const _pend = DB.pedidosOnline.filter(p => p.estado === 'pendiente').length;
          const _nb = document.getElementById('po-nav-badge');
          if (_nb) { _nb.textContent = _pend || ''; _nb.style.display = _pend > 0 ? 'inline-block' : 'none'; }
        } catch(e) {}
      // Refrescar dashboard si está visible
      try {
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-dashboard') renderDashboard();
      } catch(e) {}
    }, err => {
      console.warn('pedidos_online listener error:', err.code);
    });
}
function renderPedidosOnline() {
  if (!DB.pedidosOnline) DB.pedidosOnline = [];
  const filtro = document.getElementById('po-filtro')?.value || '';
  const desde  = document.getElementById('po-desde')?.value  || '';
  const hasta  = document.getElementById('po-hasta')?.value  || '';

  let lista = [...DB.pedidosOnline];
  if (filtro) lista = lista.filter(p => p.estado === filtro);
  if (desde)  lista = lista.filter(p => p.fecha >= desde);
  if (hasta)  lista = lista.filter(p => p.fecha <= hasta);
  lista.sort((a,b) => (b.id||0) > (a.id||0) ? 1 : -1);

  const pendientes = DB.pedidosOnline.filter(p => p.estado === 'pendiente').length;
  const badge = document.getElementById('po-badge-pendiente');
  if (badge) badge.textContent = pendientes + ' pendientes';

  const badgeColor  = { pendiente:'badge-orange', procesado:'badge-blue', entregado:'badge-green', cancelado:'badge-red' };
  const borderColor = { pendiente:'warning', procesado:'info', entregado:'accent', cancelado:'danger' };

  const listEl = document.getElementById('po-list');
  if (!listEl) return;
  if (lista.length === 0) {
    listEl.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--gray-400)">🛍️ Sin pedidos para los filtros seleccionados</div>';
    return;
  }

  // ── Agrupar por teléfono normalizado (fallback: nombre) ─────────────────
  const grupos = {};
  lista.forEach(p => {
    const key = (p.telefono||p.clienteTel||'').replace(/\s/g,'') || (p.clienteNombre||'?').toLowerCase();
    if (!grupos[key]) grupos[key] = { nombre: p.clienteNombre||'Cliente', tel: p.clienteTel||p.telefono||'', pedidos: [] };
    grupos[key].pedidos.push(p);
  });

  // Primero grupos con pendientes, luego por más reciente
  const gruposArr = Object.values(grupos).sort((a, b) => {
    const aPend = a.pedidos.some(p => p.estado === 'pendiente') ? 1 : 0;
    const bPend = b.pedidos.some(p => p.estado === 'pendiente') ? 1 : 0;
    if (bPend !== aPend) return bPend - aPend;
    return (b.pedidos[0]?.id||0) > (a.pedidos[0]?.id||0) ? 1 : -1;
  });

  listEl.innerHTML = gruposArr.map(g => {
    const totalGrupo = g.pedidos.reduce((s,p) => s+(p.total||0), 0);
    const pendGrupo  = g.pedidos.filter(p => p.estado === 'pendiente').length;

    const pedidosHTML = g.pedidos.map(p => {
      const entregado = p.estado === 'entregado';
      const cancelado = p.estado === 'cancelado';
      const bloqueado = entregado || cancelado;
      return `
      <div style="border:1px solid var(--gray-200);border-radius:8px;padding:.75rem;margin-bottom:.5rem;border-left:3px solid var(--${borderColor[p.estado]||'gray-300'})">
        <div class="flex-between" style="margin-bottom:.35rem;flex-wrap:wrap;gap:.35rem">
          <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <span style="font-size:.78rem;color:var(--gray-500)">${formatDate(p.fecha)} ${p.hora||''}</span>
            <span class="badge ${badgeColor[p.estado]||'badge-gray'}">${p.estado}</span>
            ${p.editado ? `<span class="badge badge-purple">✏️ editado</span>` : ''}
          </div>
          <strong style="color:var(--primary)">${sol(p.total)}</strong>
        </div>
        <div style="font-size:.8rem;color:var(--gray-700);margin-bottom:.4rem;line-height:1.5">
          ${(p.items||[]).filter(i=>i.cant>0&&!i.eliminado).map(i=>`${i.nombre} x${i.cant} — ${sol(subtotalItemCarrito(i))}`).join(' &nbsp;·&nbsp; ')}
        </div>
        <div class="flex-between" style="flex-wrap:wrap;gap:.4rem">
          <span style="font-size:.78rem;color:var(--gray-500)">
            ${p.entrega==='delivery'?'🚚 Delivery':'🏪 Recojo'} &nbsp;·&nbsp; 💳 ${p.metodo||'-'}
            ${p.descuento>0?`&nbsp;·&nbsp;<span style="color:var(--accent)">-${sol(p.descuento)} desc.</span>`:''}
          </span>
          <div style="display:flex;gap:.35rem;align-items:center">
            ${!bloqueado ? `<button class="btn btn-outline btn-xs" style="color:var(--primary);border-color:var(--primary)" onclick="editarPedidoOnline('${p.id}')">✏️ Editar</button>` : ''}
            <select class="form-control" style="width:130px;font-size:.78rem" id="po-estado-${p.id}" ${bloqueado?'disabled':''}>
              <option value="pendiente"  ${p.estado==='pendiente' ?'selected':''}>Pendiente</option>
              <option value="procesado"  ${p.estado==='procesado' ?'selected':''}>Procesado</option>
              <option value="entregado"  ${p.estado==='entregado' ?'selected':''}>✅ Entregado</option>
              <option value="cancelado"  ${p.estado==='cancelado' ?'selected':''}>❌ Cancelado</option>
              <option value="eliminar" style="color:var(--danger)">🗑️ Eliminar</option>
            </select>
            ${!bloqueado ? `<button class="btn btn-primary btn-xs" onclick="confirmarEntregaPedido('${p.id}')">Guardar</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card" style="margin-bottom:.75rem;border-left:4px solid var(--${pendGrupo>0?'warning':'gray-300'})">
      <div class="flex-between" style="margin-bottom:.6rem;flex-wrap:wrap;gap:.4rem">
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <strong style="font-size:.95rem">👤 ${g.nombre}</strong>
          ${g.tel ? `<span style="font-size:.75rem;color:var(--gray-500)">📱 ${g.tel}</span>` : ''}
          ${pendGrupo>0 ? `<span class="badge badge-orange">${pendGrupo} pendiente${pendGrupo>1?'s':''}</span>` : ''}
        </div>
        <div style="text-align:right">
          <span style="font-size:.78rem;color:var(--gray-500)">${g.pedidos.length} pedido${g.pedidos.length>1?'s':''}</span>
          <strong style="color:var(--primary);margin-left:.5rem">Total: ${sol(totalGrupo)}</strong>
        </div>
      </div>
      ${pedidosHTML}
    </div>`;
  }).join('');
}

// ── Editar pedido online (modal completo) ─────────────────────────────────────
let _poEditId = null;

function editarPedidoOnline(id) {
  if (!DB.pedidosOnline) return;
  const p = DB.pedidosOnline.find(x => String(x.id) === String(id));
  if (!p) return;
  if (p.estado === 'entregado' || p.estado === 'cancelado') {
    alert('Este pedido ya está cerrado y no puede editarse.'); return;
  }
  _poEditId = id;

  // Asegurar que el modal existe
  _asegurarModalEditarPedido();

  // Rellenar datos del cliente
  document.getElementById('po-edit-cliente').textContent  = p.clienteNombre || 'Cliente';
  document.getElementById('po-edit-tel').textContent      = p.clienteTel ? '📱 ' + p.clienteTel : '';
  document.getElementById('po-edit-fecha').textContent    = formatDate(p.fecha) + ' ' + (p.hora||'');

  // Método de pago
  const metSel = document.getElementById('po-edit-metodo');
  metSel.value = p.metodo || 'Efectivo';

  // Entrega
  document.getElementById('po-edit-entrega').value = p.entrega || 'recojo';

  // Descuento
  document.getElementById('po-edit-descuento').value = p.descuento || 0;

  // Nota
  document.getElementById('po-edit-nota').value = p.notaAdmin || '';

  // Items editables
  _renderItemsEditorPedido(p.items || []);

  abrirModal('modal-editar-pedido');
}

function _renderItemsEditorPedido(items) {
  const tbody = document.getElementById('po-edit-items');
  if (!tbody) return;
  tbody.innerHTML = items.map((item, i) => `
    <tr id="po-row-${i}" style="${item.cant <= 0 || item.eliminado ? 'opacity:.45;text-decoration:line-through' : ''}">
      <td style="font-size:.83rem;font-weight:600">${item.nombre}</td>
      <td>
        <div style="display:flex;align-items:center;gap:.3rem">
          <button class="qty-btn" onclick="poItemCant(${i},-1)" title="Reducir">−</button>
          <span id="po-cant-${i}" style="min-width:28px;text-align:center;font-weight:700">${item.cant}</span>
          <button class="qty-btn" onclick="poItemCant(${i},1)" title="Aumentar">+</button>
        </div>
      </td>
      <td style="font-size:.82rem">S/ ${item.precio.toFixed(2)}</td>
      <td id="po-subtotal-${i}" style="font-weight:700;color:var(--primary)">S/ ${subtotalItemCarrito(item).toFixed(2)}</td>
      <td>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="poEliminarItem(${i})" title="Eliminar producto">🗑️</button>
      </td>
    </tr>`).join('');
  _poRecalcTotal();
}

// Items editados en memoria durante el modal
let _poItemsTemp = [];

function _asegurarModalEditarPedido() {
  if (document.getElementById('modal-editar-pedido')) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id = 'modal-editar-pedido';
  div.innerHTML = `
  <div class="modal modal-lg">
    <div class="modal-header">
      <h3>✏️ Editar Pedido Online</h3>
      <button class="modal-close" onclick="cerrarModal('modal-editar-pedido')">✕</button>
    </div>

    <!-- Info cliente -->
    <div style="background:var(--primary-light);border-radius:8px;padding:.65rem 1rem;margin-bottom:1rem;display:flex;gap:1rem;flex-wrap:wrap;align-items:center">
      <strong id="po-edit-cliente">-</strong>
      <span id="po-edit-tel" style="font-size:.78rem;color:var(--primary-dark)"></span>
      <span id="po-edit-fecha" style="font-size:.75rem;color:var(--gray-500);margin-left:auto"></span>
    </div>

    <!-- Tabla de productos -->
    <div style="font-size:.78rem;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:.4rem">Productos del pedido</div>
    <div class="table-wrap" style="margin-bottom:1rem">
      <table style="width:100%">
        <thead>
          <tr>
            <th>Producto</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th><th></th>
          </tr>
        </thead>
        <tbody id="po-edit-items"></tbody>
      </table>
    </div>

    <!-- Descuento -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;margin-bottom:1rem">
      <div class="form-group" style="margin:0">
        <label>Método de pago</label>
        <select class="form-control" id="po-edit-metodo">
          <option value="Efectivo">💵 Efectivo</option>
          <option value="Yape">💜 Yape</option>
          <option value="Plin">💚 Plin</option>
          <option value="QR">📱 QR</option>
          <option value="Link de pago">🔗 Link de pago</option>
          <option value="Tarjeta POS">💳 Tarjeta POS</option>
          <option value="Tarjeta POS Móvil">📲 Tarjeta POS Móvil</option>
          <option value="Transferencia">🏦 Transferencia</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label>Entrega</label>
        <select class="form-control" id="po-edit-entrega">
          <option value="recojo">🏪 Recojo en tienda</option>
          <option value="delivery">🚚 Delivery</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label>Descuento (S/)</label>
        <input type="number" class="form-control" id="po-edit-descuento" min="0" step="0.10" value="0" oninput="_poRecalcTotal()" />
      </div>
    </div>

    <div class="form-group" style="margin-bottom:1rem">
      <label>Nota interna (solo admin)</label>
      <input type="text" class="form-control" id="po-edit-nota" placeholder="Ej: Cliente confirmó eliminar la leche" />
    </div>

    <!-- Total recalculado -->
    <div style="background:var(--gray-50);border-radius:8px;padding:.75rem 1rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <span style="color:var(--gray-600);font-size:.9rem">Total actualizado</span>
      <span id="po-edit-total" style="font-size:1.3rem;font-weight:800;color:var(--primary)">S/ 0.00</span>
    </div>

    <div style="display:flex;gap:.5rem;justify-content:flex-end">
      <button class="btn btn-outline" onclick="cerrarModal('modal-editar-pedido')">Cancelar</button>
      <button class="btn btn-primary" onclick="guardarEdicionPedido()">💾 Guardar cambios</button>
    </div>
  </div>`;
  document.body.appendChild(div);
}

function poItemCant(i) {
  // Recibe (index, delta) — llamado desde onclick
  const delta = arguments[1];
  const p = DB.pedidosOnline.find(x => String(x.id) === String(_poEditId));
  if (!p) return;
  const item = p.items[i];
  if (!item) return;
  const nueva = Math.max(0, item.cant + delta);
  item.cant = nueva;
  // Actualizar UI de la fila
  const cantEl = document.getElementById('po-cant-'+i);
  const rowEl  = document.getElementById('po-row-'+i);
  const subEl  = document.getElementById('po-subtotal-'+i);
  if (cantEl) cantEl.textContent = nueva;
  if (subEl)  subEl.textContent = 'S/ ' + (item.precio * nueva).toFixed(2);
  if (rowEl)  rowEl.style.opacity = nueva <= 0 ? '0.4' : '1';
  if (rowEl)  rowEl.style.textDecoration = nueva <= 0 ? 'line-through' : '';
  _poRecalcTotal();
}

function poEliminarItem(i) {
  const p = DB.pedidosOnline.find(x => String(x.id) === String(_poEditId));
  if (!p) return;
  if (!confirm('¿Eliminar "' + p.items[i].nombre + '" del pedido?')) return;
  p.items[i].cant = 0;
  p.items[i].eliminado = true;
  const rowEl = document.getElementById('po-row-'+i);
  const cantEl = document.getElementById('po-cant-'+i);
  const subEl  = document.getElementById('po-subtotal-'+i);
  if (rowEl)  { rowEl.style.opacity = '0.35'; rowEl.style.textDecoration = 'line-through'; }
  if (cantEl) cantEl.textContent = '0';
  if (subEl)  subEl.textContent = 'S/ 0.00';
  _poRecalcTotal();
}

function _poRecalcTotal() {
  const p = DB.pedidosOnline.find(x => String(x.id) === String(_poEditId));
  if (!p) return;
  const desc = parseFloat(document.getElementById('po-edit-descuento')?.value) || 0;
  const subtotal = (p.items||[]).reduce((s,i) => s + (i.precio * Math.max(0, i.cant)), 0);
  const total = Math.max(0, subtotal - desc);
  const el = document.getElementById('po-edit-total');
  if (el) el.textContent = sol(total);
}

function guardarEdicionPedido() {
  if (!DB.pedidosOnline) return;
  const idx = DB.pedidosOnline.findIndex(x => String(x.id) === String(_poEditId));
  if (idx < 0) return;
  // Lock Firestore listener immediately to prevent revert
  _fbEscribiendo = true;
  const p = DB.pedidosOnline[idx];

  const desc     = parseFloat(document.getElementById('po-edit-descuento')?.value) || 0;
  const metodo   = document.getElementById('po-edit-metodo')?.value   || p.metodo;
  const entrega  = document.getElementById('po-edit-entrega')?.value  || p.entrega;
  const nota     = document.getElementById('po-edit-nota')?.value     || '';

  // Recalcular total con items actuales y descuento
  const itemsActivos = (p.items||[]).filter(i => i.cant > 0 && !i.eliminado);
  const subtotal     = itemsActivos.reduce((s,i) => s + subtotalItemCarrito(i), 0);
  const total        = Math.max(0, subtotal - desc);

  // Si todos los productos fueron eliminados, advertir
  if (itemsActivos.length === 0) {
    if (!confirm('⚠️ El pedido quedará sin productos. ¿Deseas cancelarlo automáticamente?')) return;
    p.estado = 'cancelado';
  }

  p.items      = p.items; // ya modificado en memoria (poItemCant / poEliminarItem)
  p.metodo     = metodo;
  p.entrega    = entrega;
  p.descuento  = desc;
  p.total      = total;
  p.notaAdmin  = nota;
  p.editado    = true;
  p.fechaEdicion = today() + ' ' + nowTime();

  // Actualizar documento en colección pedidos_online (Firestore)
  if (dbModular) { // [SDK modular]
    updateDocM(docM(dbModular, 'pedidos_online', String(p.id)), {
      items:       p.items,
      metodo:      p.metodo,
      entrega:     p.entrega,
      descuento:   p.descuento,
      total:       p.total,
      notaAdmin:   p.notaAdmin,
      editado:     true,
      estado:      p.estado,
      fechaEdicion: p.fechaEdicion
    }).catch(e => console.warn('pedidos_online edit error:', e.code));
  }

  // Guardar cambios operativos en aleze/db
  fbGuardar();
  setTimeout(() => { _fbEscribiendo = false; }, 8000);
  cerrarModal('modal-editar-pedido');
  renderPedidosOnline();
  try { renderDashboard(); }       catch(e){}
  try { renderHistorialVentas(); } catch(e){}
  alert('✅ Pedido actualizado correctamente.');
}

function _dialogoPagoOnline(nombre, callback) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box';
  ov.innerHTML = `
    <div style="background:white;border-radius:14px;padding:1.5rem;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,0.2)">
      <div style="font-weight:700;font-size:1rem;color:var(--gray-900);margin-bottom:1.25rem">
        💳 Registrar pago — <em style="color:var(--primary)">${nombre||'cliente'}</em>
      </div>
      <label id="_dlg-lbl-c" style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem;border:1.5px solid var(--gray-200);border-radius:8px;cursor:pointer;margin-bottom:.5rem">
        <input type="radio" name="_dlg_po" value="cobrado" style="width:18px;height:18px;margin-top:2px;flex-shrink:0" />
        <span><strong>✅ Pedido pagado</strong><br><span style="font-size:.78rem;color:var(--gray-500)">Va a historial de ventas y caja</span></span>
      </label>
      <label id="_dlg-lbl-f" style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem;border:1.5px solid var(--gray-200);border-radius:8px;cursor:pointer;margin-bottom:1.25rem">
        <input type="radio" name="_dlg_po" value="fiado" style="width:18px;height:18px;margin-top:2px;flex-shrink:0" />
        <span><strong>📋 Pedido fiado</strong><br><span style="font-size:.78rem;color:var(--gray-500)">Va al módulo de fiados</span></span>
      </label>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button id="_dlg-btn-c" style="padding:.55rem 1rem;border-radius:8px;border:1px solid var(--gray-300);background:white;cursor:pointer;font-size:.85rem">Cancelar</button>
        <button id="_dlg-btn-a" style="padding:.55rem 1rem;border-radius:8px;border:none;background:var(--primary);color:white;cursor:pointer;font-size:.85rem;font-weight:600">Aceptar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('input[name="_dlg_po"]').forEach(r => r.addEventListener('change', () => {
    document.getElementById('_dlg-lbl-c').style.borderColor = r.value==='cobrado' ? 'var(--primary)' : 'var(--gray-200)';
    document.getElementById('_dlg-lbl-f').style.borderColor = r.value==='fiado'   ? 'var(--primary)' : 'var(--gray-200)';
  }));
 const _dlgTimeout = setTimeout(() => {
    if (document.body.contains(ov)) {
      document.body.removeChild(ov);
      callback(null);
    }
  }, 60000);

  document.getElementById('_dlg-btn-c').onclick = () => {
    clearTimeout(_dlgTimeout);
    document.body.removeChild(ov); callback(null);
  };
 document.getElementById('_dlg-btn-a').onclick = () => {
    const sel = ov.querySelector('input[name="_dlg_po"]:checked');
    if (!sel) { alert('Selecciona una opción'); return; }
    clearTimeout(_dlgTimeout);
    document.body.removeChild(ov);
    callback(sel.value);
  };
}

// ── Confirmar entrega con validación de stock ─────────────────────────────────
function confirmarEntregaPedido(id) {
  if (!DB.pedidosOnline) return;
  const p = DB.pedidosOnline.find(x => String(x.id) === String(id));
  if (!p) return;
  const nuevoEstado = document.getElementById('po-estado-'+id)?.value;
  if (!nuevoEstado) return;
  // Lock listener immediately so the re-render after fbGuardar() doesn't revert
 _fbEscribiendo = true;
  let _esPagado = true; // se define al confirmar entrega (cobrado o fiado)

  // Si se marca como entregado: verificar stock y confirmar
  if (nuevoEstado === 'entregado' && p.estado !== 'entregado') {
    // Sede que despacha: automática según el perfil de quien confirma; el admin puede anularla
    let _sedeDespacho = currentUserSedeId || 'principal';
    if (currentRole === 'admin') {
      const _idxSede = prompt(`¿Desde qué sede se despacha este pedido?\n1. Principal${_sedeDespacho==='principal'?' (tu sede)':''}\n2. Tienda Aleze II${_sedeDespacho==='Tienda Aleze II'?' (tu sede)':''}`, _sedeDespacho === 'principal' ? '1' : '2');
      if (_idxSede === '1') _sedeDespacho = 'principal';
      else if (_idxSede === '2') _sedeDespacho = 'Tienda Aleze II';
      // Cancelar o valor inválido → se queda con su propia sede por defecto
    }
    // Revisar stock suficiente en la sede que va a despachar
    const sinStock = (p.items||[]).filter(i => i.cant > 0 && !i.eliminado).filter(item => {
      const prod = DB.productos.find(x => x.id === item.prodId);
      return prod && stockEnSede(prod, _sedeDespacho) < item.cant;
    });

    let confirmMsg = `¿Confirmar entrega del pedido de ${p.clienteNombre||'cliente'}?\n\nSe despacha desde: ${_sedeDespacho}\n\nProductos a descontar del inventario:\n`;
    (p.items||[]).filter(i=>i.cant>0&&!i.eliminado).forEach(i => {
      confirmMsg += `• ${i.nombre} x${i.cant} — ${sol(subtotalItemCarrito(i))}\n`;
    });
    confirmMsg += `\nTotal: ${sol(p.total)}\nMétodo: ${p.metodo}`;
    if (sinStock.length > 0) {
      confirmMsg += `\n\n⚠️ ALERTA: Los siguientes productos tienen stock insuficiente en ${_sedeDespacho}:\n`;
      sinStock.forEach(item => {
        const prod = DB.productos.find(x => x.id === item.prodId);
        confirmMsg += `• ${item.nombre}: necesitas ${item.cant}, disponible ${prod?stockEnSede(prod,_sedeDespacho):0}\n`;
      });
      confirmMsg += '\n¿Continuar de todas formas?';
    }
if (!confirm(confirmMsg)) { _fbEscribiendo = false; return; }

    // ── Dialog async: cobrado o fiado ────────────────────────────────────────
    _dialogoPagoOnline(p.clienteNombre, async function(tipoPago) {
      if (tipoPago === null) { _fbEscribiendo = false; return; }
      _esPagado = (tipoPago === 'cobrado');
      if (!dbModular) { _fbEscribiendo = false; alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
      await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()

      // ── Matching / creación de cliente ────────────────────────────────────
      const telNorm = (p.telefono||p.clienteTel||'').replace(/\s/g,'');
      let cli = telNorm ? DB.clientes.find(c=>(c.tel||'').replace(/\s/g,'')=== telNorm) : null;
      let _esClienteNuevo = false;
      if (!cli && (p.clienteNombre||'').length >= 2) {
        cli = _envolverCliente({ id: getId(), nombre: p.clienteNombre, alias: p.clienteNombre,
                tel: p.clienteTel||p.telefono||'', dir: p.clienteDir||'',
                cumple: '', compras: 0, total: 0, deuda: 0 });
        _esClienteNuevo = true;
      }

      const itemsFinales = (p.items||[]).filter(i=>i.cant>0&&!i.eliminado);

      // ── Validar productos ANTES de tocar nada ───────────────────────────────
      for (const item of itemsFinales) {
        if (!DB.productos.find(x => x.id === item.prodId)) {
          _fbEscribiendo = false;
          alert('⚠️ No se pudo confirmar la entrega: "' + (item.nombre||item.prodId) + '" ya no existe en el catálogo.\n\nNo se aplicó nada. Revisa el pedido e intenta de nuevo.');
          return;
        }
      }

      // ── Paquete atomico: stock (todos los items), venta/fiado, cliente, caja,
      // movimiento y el pedido marcado como entregado viajan juntos — todo o nada.
      const batch = writeBatchM(dbModular);
      const _deltasPorProducto = new Map();
      const _acumular = (prod, delta) => {
        const actual = _deltasPorProducto.get(prod.id);
        if (actual) actual.delta += delta;
        else _deltasPorProducto.set(prod.id, { prod, delta });
      };
      itemsFinales.forEach(item => {
        const prod = DB.productos.find(x => x.id === item.prodId);
        if (!prod.esCombo) _acumular(prod, -item.cant);
        if (prod.esCombo && prod.componentes) {
          prod.componentes.forEach(comp => {
            const cp = DB.productos.find(x => x.id === comp.prodId);
            if (cp) _acumular(cp, -(comp.cant * item.cant));
          });
        }
      });
      const _deltasStock = [];
      _deltasPorProducto.forEach(({prod, delta}) => {
        batch.set(docM(dbModular, 'stock', String(prod.id)),
          { [`stockPorSede.${_sedeDespacho}`]: incrementM(delta) }, { merge: true });
        _deltasStock.push({ prod, delta });
      });

      let _ventaOnline = null, _fiadoOnline = null;
      if (_esPagado) {
        const _itemsConCosto = itemsFinales.map(i => {
          const prod = DB.productos.find(x => x.id === i.prodId);
          return { ...i, costoUnitario: prod ? prod.costo : 0 };
        });
        _ventaOnline = {
          id: p.id, fecha: p.fecha, hora: p.hora,
          cajero: currentUser||'Online', clienteId: cli ? cli.id : null,
          clienteNombre: p.clienteNombre, items: _itemsConCosto,
          subtotal: itemsFinales.reduce((s,i)=>s+subtotalItemCarrito(i),0),
          descuento: p.descuento || 0, total: p.total, metodo: p.metodo,
          origen: 'online', estado: 'completado',
          estadoStock: 'descontado', notaAdmin: p.notaAdmin || '',
          sedeId: _sedeDespacho
        };
        batch.set(docM(dbModular, 'ventas', String(_ventaOnline.id)), _ventaOnline);
        if (cli) {
          batch.set(docM(dbModular, 'clientes', String(cli.id)),
            _esClienteNuevo
              ? { id: cli.id, nombre: cli.nombre, alias: cli.alias, tel: cli.tel, dir: cli.dir||'', cumple: '', compras: 1, total: p.total, deuda: 0, puntos: 0 }
              : { compras: incrementM(1), total: incrementM(p.total) },
            { merge: true });
        }
      } else {
        if (cli) {
          _fiadoOnline = {
            id: p.id, clienteId: cli.id,
            items: itemsFinales.map(i => {
              const prod = DB.productos.find(x => x.id === i.prodId);
              return { ...i, costoUnitario: prod ? prod.costo : 0 };
            }),
            total: p.total, pagado: 0, fecha: p.fecha,
            descuentoCombo: p.descuento || 0, descuentoManual: 0,
            origenOnline: true, sedeId: _sedeDespacho, estado: 'pendiente'
          };
          batch.set(docM(dbModular, 'fiados', String(_fiadoOnline.id)), _fiadoOnline);
          batch.set(docM(dbModular, 'clientes', String(cli.id)),
            _esClienteNuevo
              ? { id: cli.id, nombre: cli.nombre, alias: cli.alias, tel: cli.tel, dir: cli.dir||'', cumple: '', compras: 1, total: p.total, deuda: p.total, puntos: 0 }
              : { compras: incrementM(1), total: incrementM(p.total), deuda: incrementM(p.total) },
            { merge: true });
        }
        const _ventaOnlineFiado = {
          id: p.id, fecha: p.fecha, hora: p.hora,
          cajero: currentUser||'Online', clienteId: cli ? cli.id : null,
          clienteNombre: p.clienteNombre, items: itemsFinales,
          subtotal: itemsFinales.reduce((s,i)=>s+subtotalItemCarrito(i),0),
          descuento: p.descuento || 0, total: p.total, metodo: p.metodo,
          origen: 'online', estado: 'fiado',
          estadoStock: 'descontado', notaAdmin: p.notaAdmin || '',
          sedeId: _sedeDespacho
        };
        batch.set(docM(dbModular, 'ventas', String(_ventaOnlineFiado.id)), _ventaOnlineFiado);
        _ventaOnline = _ventaOnlineFiado; // usado abajo para empujar a historialVentas
      }

      const _movId = getId();
      let _movData;
      if (_esPagado) {
        batch.set(docM(dbModular, 'caja', _sedeDespacho), {
          ingresos: incrementM(p.total),
          ...(p.metodo === 'Efectivo' ? { ingresosEfectivo: incrementM(p.total) } : {})
        }, { merge: true });
        _movData = { id:_movId, tipo:'ingreso', desc:`Pedido online cobrado — ${p.clienteNombre||'cliente'}`, monto: p.total, hora: nowTime(), fecha: today(), sedeId: _sedeDespacho };
        batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
      } else {
        _movData = { id:_movId, tipo:'fiado', desc:`Fiado online — ${p.clienteNombre||'cliente'}`, monto: p.total, hora: nowTime(), fecha: today(), sedeId: _sedeDespacho };
        batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
      }

      batch.update(docM(dbModular, 'pedidos_online', String(p.id)), {
        estado: 'entregado', cajero: currentUser || 'admin',
        fechaEntrega: today(), horaEntrega: nowTime()
      });

      _sincIniciar('entrega_pedido_lote', p.id);
      try {
        await batch.commit();
        _sincTerminar('entrega_pedido_lote', p.id);
      } catch (e) {
        _sincError('entrega_pedido_lote', p.id, e, 'la entrega del pedido — no se aplicó nada, ni stock ni venta ni cliente');
        _fbEscribiendo = false;
        return;
      }

      // El lote ya fue aceptado — recien ahora se refleja todo en memoria local.
      _deltasStock.forEach(({prod, delta}) => {
        if (!prod.stockPorSede) prod.stockPorSede = { principal: prod.stock||0 };
        prod.stockPorSede[_sedeDespacho] = Math.max(0, Math.round(((prod.stockPorSede[_sedeDespacho]||0)+delta)*1000)/1000);
        prod.stock = stockTotal(prod);
      });
      if (_esClienteNuevo && cli) DB.clientes.push(cli);
      if (!DB.historialVentas) DB.historialVentas = [];
      DB.historialVentas.push(_ventaOnline);
      // El lote ya escribió el cliente en Firestore — el interruptor evita que el Proxy
      // dispare su propia escritura encima (mismo riesgo ya corregido en las otras 5 funciones).
      _clienteProxySkipSync = true;
      try {
        if (_esPagado) {
          if (cli) { cli.compras = (cli.compras||0)+1; cli.total = (cli.total||0)+p.total; }
        } else {
          if (_fiadoOnline) {
            if (!DB.fiados) DB.fiados = [];
            DB.fiados.push(_fiadoOnline);
          }
          if (cli) {
            _aplicarDeudaLocal(cli, p.total);
            cli.compras = (cli.compras||0) + 1;
            cli.total   = (cli.total||0)   + p.total;
          }
        }
      } finally { _clienteProxySkipSync = false; }
      p.estado = 'entregado';
      if (_esPagado) {
        // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
        DB.caja.ingresos += p.total;
        if (p.metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + p.total;
      
      }
      if (!DB.movimientos) DB.movimientos = [];
      DB.movimientos.push(_movData);

      fbGuardar();
      fbGuardarProductos();
      setTimeout(() => { _fbEscribiendo = false; }, 8000);

      // ── Sincronizar UI ─────────────────────────────────────────────────────
      // CRITICO: _fbEscribiendo queda en true por 8s (mas abajo) para que el listener de
      // pedidos_online no reaccione dos veces a este mismo cambio — pero ese listener es el
      // UNICO lugar del codigo que actualizaba #po-nav-badge y llamaba updateAlertCount().
      // Bloquearlo 8s bloqueaba tambien esas 2 actualizaciones, dejando el contador de
      // pedidos pendientes de la barra de navegacion sin bajar hasta que pasaran los 8s (o
      // nunca, si no volvia a disparar el listener). Se actualizan acá directo, sin depender
      // del listener bloqueado.
      renderPedidosOnline();
      try { renderInvTable(); }        catch(e){}
      try { renderHistorialVentas(); } catch(e){}
      try { renderDashboard(); }       catch(e){}
      try { renderCaja(); }            catch(e){}
      try { renderFiados(); }          catch(e){}
      try { generarReporte(); }        catch(e){}
      try { updateAlertCount(); } catch(e){}
      try {
        const _pendAhora = DB.pedidosOnline.filter(x => x.estado === 'pendiente').length;
        const _nb = document.getElementById('po-nav-badge');
        if (_nb) { _nb.textContent = _pendAhora || ''; _nb.style.display = _pendAhora > 0 ? 'inline-block' : 'none'; }
      } catch(e){}
      alert(_esPagado
        ? '✅ Pedido cobrado. Stock, caja, historial y reportes actualizados.'
        : '✅ Pedido fiado. Stock descontado, visible en módulo Fiados.');
    });
    return; // Flujo entregado es async — el código siguiente aplica solo a otros estados
  }

  // Si se elimina el pedido
  if (nuevoEstado === 'eliminar') {
    if (!confirm('¿Eliminar este pedido permanentemente?')) {
      setTimeout(() => { _fbEscribiendo = false; }, 500);
      return;
    }
    DB.pedidosOnline = DB.pedidosOnline.filter(x => String(x.id) !== String(id));
    if (dbModular) { // [SDK modular]
      deleteDocM(docM(dbModular, 'pedidos_online', String(id)))
        .catch(e => console.warn('pedidos_online delete error:', e.code));
    }
    fbGuardar();
    setTimeout(() => { _fbEscribiendo = false; }, 8000);
    renderPedidosOnline();
    try { renderDashboard(); } catch(e) {}
    return;
  }
  // Estados: procesado, cancelado — solo cambiar estado
  p.estado = nuevoEstado;
  if (dbModular) { // [SDK modular]
    updateDocM(docM(dbModular, 'pedidos_online', String(p.id)), {
      estado: nuevoEstado, cajero: currentUser || 'admin',
      fechaEntrega: null, horaEntrega: null
    }).catch(e => console.warn('pedidos_online update error:', e.code));
  }
  fbGuardar();
  fbGuardarProductos();
  setTimeout(() => { _fbEscribiendo = false; }, 8000);
  renderPedidosOnline();
  try { renderInvTable(); }        catch(e){}
  try { renderHistorialVentas(); } catch(e){}
  try { renderDashboard(); }       catch(e){}
  try { renderCaja(); }            catch(e){}
  try { renderFiados(); }          catch(e){}
  try { generarReporte(); }        catch(e){}
  alert('✅ Estado actualizado.');
}
