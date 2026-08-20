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
    // Una vez entregado, el monto que cuenta es el REAL recalculado al confirmar (totalReal) —
    // no el que declaró el cliente al hacer el pedido (total), que puede haber sido manipulado
    // o simplemente haber quedado desactualizado. Ver _recalcularTotalRealPedido() /
    // confirmarEntregaPedido(). "total" original se conserva sin tocar como evidencia.
    const _totalReal = p => (p.estado === 'entregado' && p.totalReal != null) ? p.totalReal : (p.total||0);
    const _descReal   = p => (p.estado === 'entregado' && p.descuentoReal != null) ? p.descuentoReal : (p.descuento||0);
    const totalGrupo = g.pedidos.reduce((s,p) => s+_totalReal(p), 0);
    const pendGrupo  = g.pedidos.filter(p => p.estado === 'pendiente').length;

    const pedidosHTML = g.pedidos.map(p => {
      const entregado = p.estado === 'entregado';
      const cancelado = p.estado === 'cancelado';
      const bloqueado = entregado || cancelado;
      const _diffFraude = entregado && p.totalReal != null && (p.totalReal - (p.total||0)) > 0.05;
      return `
      <div style="border:1px solid var(--gray-200);border-radius:8px;padding:.75rem;margin-bottom:.5rem;border-left:3px solid var(--${borderColor[p.estado]||'gray-300'})">
        <div class="flex-between" style="margin-bottom:.35rem;flex-wrap:wrap;gap:.35rem">
          <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <span style="font-size:.78rem;color:var(--gray-500)">${formatDate(p.fecha)} ${p.hora||''}</span>
            <span class="badge ${badgeColor[p.estado]||'badge-gray'}">${p.estado}</span>
            ${p.editado ? `<span class="badge badge-purple">✏️ editado</span>` : ''}
            ${p.totalSospechoso ? `<span class="badge badge-red" title="El total enviado está muy por debajo del precio de catálogo (referencia: ${sol(p.totalCatalogoReferencia||0)}). Revisa los items antes de confirmar.">⚠️ Total a revisar</span>` : ''}
            ${p.pedidosRecientesSospechoso ? `<span class="badge badge-red" title="${p.pedidosRecientesCantidad||0} pedidos de este mismo teléfono llegaron en pocos minutos — poco común en un cliente real. Revisa antes de confirmar.">⚠️ Varios pedidos seguidos</span>` : ''}
          </div>
          <span>
            <strong style="color:var(--primary)">${sol(_totalReal(p))}</strong>
            ${_diffFraude ? `<span style="font-size:.72rem;color:var(--danger);text-decoration:line-through;margin-left:.3rem" title="Total declarado originalmente por el cliente al hacer el pedido">${sol(p.total)}</span>` : ''}
          </span>
        </div>
        <div style="font-size:.8rem;color:var(--gray-700);margin-bottom:.4rem;line-height:1.5">
          ${(p.items||[]).filter(i=>i.cant>0&&!i.eliminado).map(i=>`${escapeHtml(i.nombre)} x${i.cant} — ${sol(subtotalItemCarrito(i))}`).join(' &nbsp;·&nbsp; ')}
        </div>
        <div class="flex-between" style="flex-wrap:wrap;gap:.4rem">
          <span style="font-size:.78rem;color:var(--gray-500)">
            ${p.entrega==='delivery'?'🚚 Delivery':'🏪 Recojo'} &nbsp;·&nbsp; 💳 ${p.metodo||'-'}
            ${_descReal(p)>0?`&nbsp;·&nbsp;<span style="color:var(--accent)">-${sol(_descReal(p))} desc.</span>`:''}
          </span>
          <div style="display:flex;gap:.35rem;align-items:center">
            ${!bloqueado ? `<button class="btn btn-outline btn-xs" style="color:var(--primary);border-color:var(--primary)" onclick="editarPedidoOnline('${p.id}')">✏️ Editar</button>` : ''}
            ${p.estado==='entregado' ? `<button class="btn btn-outline btn-xs" style="color:var(--accent);border-color:var(--accent)" onclick="verTicketPedido('${p.id}')">🎫 Ver ticket</button>` : ''}
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
          <strong style="font-size:.95rem">👤 ${escapeHtml(g.nombre)}</strong>
          ${g.tel ? `<span style="font-size:.75rem;color:var(--gray-500)">📱 ${escapeHtml(g.tel)}</span>` : ''}
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
      <td style="font-size:.83rem;font-weight:600">${escapeHtml(item.nombre)}</td>
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

// ── Recalculo del total REAL de un pedido — nunca confía en items[].precio ni
// items[].subtotalFinal del pedido público (bloque 7.6 / hallazgo 3 de la auditoría,
// 20/08/2026). pedidos_online permite create público sin login, validado solo por
// pedidoValido() en las reglas de Firestore — que NO valida precios ni el contenido de
// items[], solo su forma. Cualquiera hablando directo con el SDK desde la consola del
// navegador (sin necesitar conocimiento técnico avanzado) podría fabricar esos campos a mano.
// Esta función reconstruye el total real a partir de: (1) el precio de catálogo real de cada
// producto, vía "buscarProducto" (que el caller decide de dónde lee — ver los 2 usos abajo,
// uno de prechequeo con DB.productos, otro autoritativo con datos recién leídos en la
// transacción), y (2) las promociones vigentes (DB.promociones, sincronizadas en vivo en la
// sesión del staff — nunca controladas por el cliente público). Reusa calcComboDescuento(),
// calcDescuentoCantidad() y calcRecargoPorLimitePromo() TAL CUAL (misma lógica ya usada y
// probada en POS y en la tienda pública, exactamente la misma fórmula de
// _tndCalcularTotal()/procesarVenta()) — nunca se reimplementa esa matemática a mano, para no
// arriesgar una divergencia sutil entre esta función y el resto del sistema. Lo único que se
// hace antes de llamarlas es reemplazar item.precio por el precio real y anular
// item.subtotalFinal — así, aunque calcRecargoPorLimitePromo() internamente lea item.precio
// para un caso puntual, nunca opera sobre un valor que vino del cliente.
function _recalcularTotalRealPedido(items, buscarProducto) {
  const promoActivas = (DB.promociones || []).filter(pr => pr.activa && pr.hasta >= today() && _promoAplicaSede(pr, 'principal'));
  const itemsPrecioReal = (items || []).map(item => {
    const prodReal = buscarProducto(item.prodId);
    let precioReal = prodReal ? (prodReal.precio || 0) : (item.precio || 0); // producto ya no existe: caso ya manejado aparte (confirmarEntregaPedido lanza error antes de llegar acá), valor de respaldo inofensivo
    if (prodReal && !prodReal.esCombo) {
      const promoDelProducto = promoActivas.find(pr => !pr.packProdId && pr.prod1 == item.prodId && !pr.prod2);
      const esPromoCantidad = promoDelProducto && (promoDelProducto.tipo === '2x1' || promoDelProducto.tipo === '3x2');
      if (promoDelProducto && !esPromoCantidad && promoDelProducto.precioPromo != null) precioReal = promoDelProducto.precioPromo;
    }
    return { ...item, precio: precioReal, subtotalFinal: null };
  });
  const subtotal = itemsPrecioReal.reduce((s, i) => s + subtotalItemCarrito(i), 0);
  const combo = calcComboDescuento(itemsPrecioReal, 'principal');
  const cantidad = calcDescuentoCantidad(itemsPrecioReal, 'principal');
  const recargo = calcRecargoPorLimitePromo(itemsPrecioReal, 'principal');
  const total = Math.max(0, Math.round((subtotal - combo.total - cantidad.total + recargo.total) * 100) / 100);
  return { total, subtotal, comboDesc: combo.total, cantidadDesc: cantidad.total, recargoDesc: recargo.total, itemsPrecioReal };
}

// ── Confirmar entrega con validación de stock ─────────────────────────────────
// Reimprimir/reenviar el ticket de un pedido ya entregado — el cliente puede pedirlo de
// nuevo dias despues. Busca la venta real ya guardada (confirmarEntregaPedido() la crea con
// el mismo id que el pedido), reutiliza el mismo mostrarTicket() de siempre.
function verTicketPedido(id) {
  const venta = (DB.historialVentas||[]).find(v => String(v.id) === String(id))
             || (DB.ventas||[]).find(v => String(v.id) === String(id));
  if (!venta) { alert('No se encontró el comprobante de este pedido — puede que haya salido de la ventana de historial reciente.'); return; }
  mostrarTicket(venta);
}

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
    const _sedeDespacho = 'principal';
    // Revisar stock suficiente antes de descontar
    const sinStock = (p.items||[]).filter(i => i.cant > 0 && !i.eliminado).filter(item => {
      const prod = DB.productos.find(x => x.id === item.prodId);
      return prod && stockEnSede(prod) < item.cant;
    });

    let confirmMsg = `¿Confirmar entrega del pedido de ${p.clienteNombre||'cliente'}?\n\nProductos a descontar del inventario:\n`;
    (p.items||[]).filter(i=>i.cant>0&&!i.eliminado).forEach(i => {
      confirmMsg += `• ${i.nombre} x${i.cant} — ${sol(subtotalItemCarrito(i))}\n`;
    });
    confirmMsg += `\nTotal: ${sol(p.total)}\nMétodo: ${p.metodo}`;
    if (sinStock.length > 0) {
      confirmMsg += `\n\n⚠️ ALERTA: Los siguientes productos tienen stock insuficiente:\n`;
      sinStock.forEach(item => {
        const prod = DB.productos.find(x => x.id === item.prodId);
        confirmMsg += `• ${item.nombre}: necesitas ${item.cant}, disponible ${prod?stockEnSede(prod):0}\n`;
      });
      confirmMsg += '\n¿Continuar de todas formas?';
    }
if (!confirm(confirmMsg)) { _fbEscribiendo = false; return; }

    // ── Prechequeo de fraude (informativo, con cache local del staff) ─────────
    // Ver _recalcularTotalRealPedido() arriba para el detalle completo. Esto es SOLO una
    // pre-alerta usando DB.productos/DB.promociones (el cache local del staff, sincronizado en
    // vivo, nunca controlado por el cliente publico) — la fuente de verdad real es el
    // recalculo AUTORITATIVO dentro de la transaccion mas abajo, con datos recien leidos del
    // servidor. Este prechequeo nunca bloquea: solo avisa ANTES de abrir la transaccion:
    // el monto que finalmente se guarda es SIEMPRE el real, decida lo que decida el staff aca.
    const _preCheck = _recalcularTotalRealPedido((p.items||[]).filter(i=>i.cant>0&&!i.eliminado), (prodId) => DB.productos.find(x => x.id === prodId));
    if (_preCheck.total - (p.total||0) > 0.05) {
      const _msgFraude = `⚠️ POSIBLE PEDIDO FRAUDULENTO ⚠️\n\nEl total declarado por el cliente (${sol(p.total)}) no coincide con el total real según catálogo y promociones vigentes (${sol(_preCheck.total)}).\n\nEsto puede pasar porque el cliente manipuló el pedido (por ejemplo desde la consola del navegador), o porque los precios/promociones cambiaron desde que se hizo el pedido.\n\nDe cualquier forma, el sistema va a registrar y cobrar SIEMPRE el monto REAL (${sol(_preCheck.total)}), sin importar qué elijas aquí.\n\n¿Revisaste el pedido y quieres continuar de todas formas?`;
      if (!confirm(_msgFraude)) { _fbEscribiendo = false; return; }
    }

    // ── Dialog async: cobrado o fiado ────────────────────────────────────────
    _dialogoPagoOnline(p.clienteNombre, async function(tipoPago) {
      if (tipoPago === null) { _fbEscribiendo = false; return; }
      _esPagado = (tipoPago === 'cobrado');
      if (!dbModular) { _fbEscribiendo = false; alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
      await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()

      const telNorm = (p.telefono||p.clienteTel||'').replace(/\s/g,'');
      const _sedeDespacho = 'principal';

      // Comprobante electronico (SUNAT) — dormido hasta activarse, ver _asignarComprobante()
      // en core.js. Se pide FUERA de la transaccion de abajo a proposito: _asignarComprobante
      // ya usa su propia transaccion interna para el correlativo, y Firestore no permite
      // transacciones anidadas. Se pide UNA sola vez, antes de las 2 ramas (pagado/fiado) —
      // un pedido online necesita comprobante sea cual sea el resultado del pago.
      const _comprobante = await _asignarComprobante('boleta');

      // CRITICO: runTransaction en vez de writeBatch — antes, 2 confirmaciones casi
      // simultaneas del MISMO pedido (2 vendedores viendo el mismo pendiente, o el mismo
      // vendedor con doble-clic) pasaban ambas el chequeo de memoria local (p.estado !==
      // 'entregado') sin saber una de la otra, duplicando stock descontado, venta creada y
      // puntos otorgados. La transaccion lee el pedido REAL del servidor primero y rechaza de
      // inmediato si ya esta entregado — la segunda confirmacion nunca alcanza a duplicar nada.
      const pedidoRef = docM(dbModular, 'pedidos_online', String(p.id));
      let _r;
      try {
        _r = await runTransactionM(dbModular, async (tx) => {
          // FASE 1 — lecturas: el pedido real, cada producto involucrado, y los componentes
          // de cualquier combo entre ellos. Todo antes de cualquier escritura (regla de
          // Firestore para transacciones).
          const pedidoSnap = await tx.get(pedidoRef);
          if (!pedidoSnap.exists()) throw new Error('Este pedido ya no existe.'); // en modular, exists es un METODO
          const pServidor = pedidoSnap.data();
          if (pServidor.estado === 'entregado') {
            throw new Error('Este pedido ya fue confirmado como entregado — probablemente por otro vendedor o desde otro dispositivo, justo ahora.');
          }

          const itemsFinales = (pServidor.items||[]).filter(i=>i.cant>0&&!i.eliminado);
          const _prodSnaps = [];
          for (const item of itemsFinales) {
            const prodRef = docM(dbModular, 'productos', String(item.prodId));
            const prodSnap = await tx.get(prodRef);
            if (!prodSnap.exists()) throw new Error('"' + (item.nombre||item.prodId) + '" ya no existe en el catálogo. No se aplicó nada.');
            _prodSnaps.push({ item, ref: prodRef, data: prodSnap.data() });
          }
          // Recalculo AUTORITATIVO del total real — usa _prodSnaps recien leidos del servidor
          // DENTRO de esta misma transaccion (nunca datos que vinieron del cliente publico).
          // Ver _recalcularTotalRealPedido() arriba. De aca en adelante, todo lo que se guarda
          // (venta/fiado, cliente, caja, movimientos, puntos) usa estos valores — nunca
          // pServidor.total ni pServidor.descuento, que son datos declarados por el cliente.
          const _real = _recalcularTotalRealPedido(itemsFinales, (prodId) => {
            const pd = _prodSnaps.find(x => x.item.prodId === prodId);
            return pd ? pd.data : null;
          });
          const _totalRealFinal = _real.total;
          const _subtotalReal = _real.subtotal;
          const _descuentoReal = (_real.comboDesc||0) + (_real.cantidadDesc||0);
          const _itemsPrecioReal = _real.itemsPrecioReal; // mismo orden/longitud que itemsFinales, precio saneado, subtotalFinal anulado

          const _compSnaps = new Map(); // prodId componente -> {ref, data}
          for (const { data: prodData } of _prodSnaps) {
            if (prodData.esCombo && prodData.componentes) {
              for (const comp of prodData.componentes) {
                if (!_compSnaps.has(comp.prodId)) {
                  const compRef = docM(dbModular, 'productos', String(comp.prodId));
                  const compSnap = await tx.get(compRef);
                  if (compSnap.exists()) _compSnaps.set(comp.prodId, { ref: compRef, data: compSnap.data() });
                }
              }
            }
          }

          let cli = telNorm ? DB.clientes.find(c=>(c.tel||'').replace(/\s/g,'')=== telNorm) : null;
          let _esClienteNuevo = false;
          if (!cli && (pServidor.clienteNombre||'').length >= 2) {
            cli = _envolverCliente({ id: getId(), nombre: pServidor.clienteNombre, alias: pServidor.clienteNombre,
                    tel: pServidor.clienteTel||pServidor.telefono||'', dir: pServidor.clienteDir||'',
                    cumple: '', compras: 0, total: 0, deuda: 0 });
            _esClienteNuevo = true;
          }

          // FASE 2 — escrituras, todas juntas.
          const _deltasPorProducto = new Map();
          const _acumular = (prodId, delta) => {
            const actual = _deltasPorProducto.get(prodId);
            if (actual) actual.delta += delta;
            else _deltasPorProducto.set(prodId, { prodId, delta });
          };
          _prodSnaps.forEach(({item, data: prodData}) => {
            if (!prodData.esCombo) _acumular(item.prodId, -item.cant);
            if (prodData.esCombo && prodData.componentes) {
              prodData.componentes.forEach(comp => {
                if (_compSnaps.has(comp.prodId)) _acumular(comp.prodId, -(comp.cant * item.cant));
              });
            }
          });
          const _deltasStock = [];
          _deltasPorProducto.forEach(({prodId, delta}) => {
            tx.set(docM(dbModular, 'productos', String(prodId)), { stock: incrementM(delta) }, { merge: true });
            _deltasStock.push({ prodId, delta });
          });

          let _ventaOnline = null, _fiadoOnline = null, _puntosGanadosPedido = 0;
          if (_esPagado) {
            const _itemsConCosto = _itemsPrecioReal.map(i => {
              const pd = _prodSnaps.find(x => x.item.prodId === i.prodId);
              // CRITICO: nombre reemplazado por el real del catalogo, nunca el que el cliente
              // envio — la regla de Firestore no valida items[].nombre por contenido, asi que
              // sin esto cualquiera hablando directo con Firestore podria inyectar HTML/JS que
              // se ejecutaria en el navegador del staff al ver esta venta despues. precio ya
              // saneado (_itemsPrecioReal), subtotalFinal ya anulado — ver _recalcularTotalRealPedido().
              return { ...i, nombre: pd ? pd.data.nombre : i.nombre, costoUnitario: pd ? pd.data.costo : 0 };
            });
            _ventaOnline = {
              id: pServidor.id, fecha: pServidor.fecha, hora: pServidor.hora,
              cajero: currentUser||'Online', clienteId: cli ? cli.id : null,
              clienteNombre: pServidor.clienteNombre, items: _itemsConCosto,
              subtotal: _subtotalReal,
              descuento: _descuentoReal, total: _totalRealFinal, metodo: pServidor.metodo,
              origen: 'online', estado: 'completado',
              estadoStock: 'descontado', notaAdmin: pServidor.notaAdmin || '',
              sedeId: _sedeDespacho,
              comprobante: _comprobante
            };
            tx.set(docM(dbModular, 'ventas', String(_ventaOnline.id)), _ventaOnline);
            if (cli) {
              _puntosGanadosPedido = calcularPuntosGanados(_itemsConCosto);
              tx.set(docM(dbModular, 'clientes', String(cli.id)),
                _esClienteNuevo
                  ? { id: cli.id, nombre: cli.nombre, alias: cli.alias, tel: cli.tel, dir: cli.dir||'', cumple: '', compras: 1, total: _totalRealFinal, deuda: 0, puntos: _puntosGanadosPedido }
                  : { compras: incrementM(1), total: incrementM(_totalRealFinal), puntos: incrementM(_puntosGanadosPedido) },
                { merge: true });
            }
          } else {
            if (cli) {
              _fiadoOnline = {
                id: pServidor.id, clienteId: cli.id,
                items: _itemsPrecioReal.map(i => {
                  const pd = _prodSnaps.find(x => x.item.prodId === i.prodId);
                  // Mismo motivo que _itemsConCosto arriba — nombre real del catalogo, nunca lo
                  // que envio el cliente; precio ya saneado (_itemsPrecioReal).
                  return { ...i, nombre: pd ? pd.data.nombre : i.nombre, costoUnitario: pd ? pd.data.costo : 0 };
                }),
                total: _totalRealFinal, pagado: 0, fecha: pServidor.fecha,
                descuentoCombo: _descuentoReal, descuentoManual: 0,
                origenOnline: true, sedeId: _sedeDespacho, estado: 'pendiente'
              };
              tx.set(docM(dbModular, 'fiados', String(_fiadoOnline.id)), _fiadoOnline);
              _puntosGanadosPedido = calcularPuntosGanados(_itemsPrecioReal);
              tx.set(docM(dbModular, 'clientes', String(cli.id)),
                _esClienteNuevo
                  ? { id: cli.id, nombre: cli.nombre, alias: cli.alias, tel: cli.tel, dir: cli.dir||'', cumple: '', compras: 1, total: _totalRealFinal, deuda: _totalRealFinal, puntos: _puntosGanadosPedido }
                  : { compras: incrementM(1), total: incrementM(_totalRealFinal), deuda: incrementM(_totalRealFinal), puntos: incrementM(_puntosGanadosPedido) },
                { merge: true });
            }
            const _itemsFiadoConNombreReal = _itemsPrecioReal.map(i => {
              const pd = _prodSnaps.find(x => x.item.prodId === i.prodId);
              return { ...i, nombre: pd ? pd.data.nombre : i.nombre };
            });
            const _ventaOnlineFiado = {
              id: pServidor.id, fecha: pServidor.fecha, hora: pServidor.hora,
              cajero: currentUser||'Online', clienteId: cli ? cli.id : null,
              clienteNombre: pServidor.clienteNombre, items: _itemsFiadoConNombreReal,
              subtotal: _subtotalReal,
              descuento: _descuentoReal, total: _totalRealFinal, metodo: pServidor.metodo,
              origen: 'online', estado: 'fiado',
              estadoStock: 'descontado', notaAdmin: pServidor.notaAdmin || '',
              sedeId: _sedeDespacho,
              comprobante: _comprobante
            };
            tx.set(docM(dbModular, 'ventas', String(_ventaOnlineFiado.id)), _ventaOnlineFiado);
            _ventaOnline = _ventaOnlineFiado;
          }

          const _movId = getId();
          let _movData;
          if (_esPagado) {
            tx.set(docM(dbModular, 'caja', _sedeDespacho), {
              ingresos: incrementM(_totalRealFinal),
              ...(pServidor.metodo === 'Efectivo' ? { ingresosEfectivo: incrementM(_totalRealFinal) } : {})
            }, { merge: true });
            _movData = { id:_movId, tipo:'ingreso', desc:`Pedido online cobrado — ${pServidor.clienteNombre||'cliente'}`, monto: _totalRealFinal, hora: nowTime(), fecha: today(), sedeId: _sedeDespacho };
            tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
          } else {
            _movData = { id:_movId, tipo:'fiado', desc:`Fiado online — ${pServidor.clienteNombre||'cliente'}`, monto: _totalRealFinal, hora: nowTime(), fecha: today(), sedeId: _sedeDespacho };
            tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
          }

          // totalReal/descuentoReal quedan en el propio pedido_online como registro — el campo
          // "total" original (lo que declaró el cliente) se conserva tal cual, sin tocar, como
          // evidencia de lo que efectivamente se envió (útil si hay que revisar un intento de
          // fraude despues). renderPedidosOnline() prioriza totalReal para mostrar en el
          // historial una vez entregado, para no dejar en pantalla un monto que ya no es el que
          // se cobró/registró de verdad.
          tx.set(pedidoRef, {
            estado: 'entregado', cajero: currentUser || 'admin',
            fechaEntrega: today(), horaEntrega: nowTime(),
            totalReal: _totalRealFinal, descuentoReal: _descuentoReal
          }, { merge: true });

          return { pServidor, itemsFinales, _deltasStock, _ventaOnline, _fiadoOnline, _puntosGanadosPedido, _movData, cli, _esClienteNuevo, _totalRealFinal, _descuentoReal };
        });
      } catch (e) {
        _fbEscribiendo = false;
        alert('⚠️ No se pudo confirmar la entrega: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
        return;
      }

      // La transaccion ya fue aceptada — recien ahora se refleja todo en memoria local.
      _r._deltasStock.forEach(({prodId, delta}) => {
        const prod = DB.productos.find(x => x.id === prodId);
        if (prod) prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
      });
      const cli = _r.cli;
      if (_r._esClienteNuevo && cli) DB.clientes.push(cli);
      if (!DB.historialVentas) DB.historialVentas = [];
      DB.historialVentas.push(_r._ventaOnline);
      // El lote ya escribió el cliente en Firestore — el interruptor evita que el Proxy
      // dispare su propia escritura encima (mismo riesgo ya corregido en las otras funciones).
      _clienteProxySkipSync = true;
      try {
        if (_esPagado) {
          if (cli) { cli.compras = (cli.compras||0)+1; cli.total = (cli.total||0)+_r._totalRealFinal; cli.puntos = (cli.puntos||0) + _r._puntosGanadosPedido; }
        } else {
          if (_r._fiadoOnline) {
            if (!DB.fiados) DB.fiados = [];
            DB.fiados.push(_r._fiadoOnline);
          }
          if (cli) {
            _aplicarDeudaLocal(cli, _r._totalRealFinal);
            cli.compras = (cli.compras||0) + 1;
            cli.total   = (cli.total||0)   + _r._totalRealFinal;
            cli.puntos  = (cli.puntos||0)  + _r._puntosGanadosPedido;
          }
        }
      } finally { _clienteProxySkipSync = false; }
      p.estado = 'entregado';
      p.totalReal = _r._totalRealFinal;
      p.descuentoReal = _r._descuentoReal;
      if (_esPagado) {
        // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
        DB.caja.ingresos += _r._totalRealFinal;
        if (_r.pServidor.metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + _r._totalRealFinal;

      }
      if (!DB.movimientos) DB.movimientos = [];
      DB.movimientos.push(_r._movData);

      fbGuardar();
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
      // Mismo ticket ya usado en los 3 flujos de POS (venta normal, venta con fiado, cobro de
      // fiado existente) — reutiliza _ventaOnline/_ventaOnlineFiado, que ya trae exactamente
      // los campos que mostrarTicket() necesita. El modal ya incluye imprimir y compartir por
      // WhatsApp como imagen — para un cliente de pedido online, que normalmente no esta
      // presente fisicamente, el envio por WhatsApp es la forma real de entregarle su
      // comprobante.
      mostrarTicket(_r._ventaOnline);
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
    // Mismo motivo que en el caso "entregado" de mas arriba — el listener queda bloqueado
    // 8s y es el unico lugar que actualizaba el badge, dejandolo desactualizado hasta que
    // volviera a dispararse. Se actualiza aca directo, sin depender del listener bloqueado.
    try {
      const _pendAhora = DB.pedidosOnline.filter(x => x.estado === 'pendiente').length;
      const _nb = document.getElementById('po-nav-badge');
      if (_nb) { _nb.textContent = _pendAhora || ''; _nb.style.display = _pendAhora > 0 ? 'inline-block' : 'none'; }
    } catch(e) {}
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
