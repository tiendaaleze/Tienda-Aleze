// ===================== RECORDATORIOS =====================
// Modulo de proposito general para seguimiento de pendientes con un cliente — envases
// retornables, herramientas prestadas, o cualquier otra cosa que el negocio necesite
// recordar y confirmar cuando se devuelve. Los campos son de uso libre a proposito, no estan
// atados a ningun concepto especifico. Completamente independiente del proceso de venta: no
// toca stock, caja, ni ninguna otra parte del sistema — solo su propia coleccion.
// Visible para todo el staff (admin y vendedor por igual), sin restriccion de rol.

let editingRecordatorioId = null;

function abrirModalRecordatorio(id) {
  editingRecordatorioId = id || null;
  const r = id ? DB.recordatorios.find(x => x.id === id) : null;
  document.getElementById('rec-modal-titulo').textContent = r ? 'Editar Recordatorio' : 'Nuevo Recordatorio';
  document.getElementById('rec-tipo').value = r ? r.tipo : '';
  document.getElementById('rec-cantidad').value = r ? r.cantidad : 1;
  document.getElementById('rec-fecha-entrega').value = r ? r.fechaEntrega : today();
  document.getElementById('rec-obs').value = r ? (r.obs || '') : '';
  const cli = r ? DB.clientes.find(c => c.id === r.clienteId) : null;
  document.getElementById('rec-cliente').innerHTML = cli ? `<option value="${cli.id}">${escapeHtml(cli.nombre)}</option>` : '';
  document.getElementById('rec-cliente').value = cli ? cli.id : '';
  document.getElementById('rec-cliente-buscar').value = cli ? (cli.alias || cli.nombre) : '';
  abrirModal('modal-recordatorio');
}

// Buscador de cliente con autocompletado — mismo patron visual ya usado en POS/Promociones,
// nombres propios para no chocar con esas otras funciones ni depender de ellas.
function _recClienteBuscar() {
  const q = (document.getElementById('rec-cliente-buscar')?.value || '').trim();
  const sug = document.getElementById('rec-cliente-sugerencias');
  if (!sug) return;
  const matches = (q ? DB.clientes.filter(c => _norm(c.nombre).includes(_norm(q)) || _norm(c.alias||'').includes(_norm(q)) || (c.tel||'').includes(q)) : DB.clientes).slice(0, 8);
  if (!matches.length) {
    sug.innerHTML = `<div style="padding:.5rem;color:var(--gray-400)">Sin resultados</div>`;
  } else {
    sug.innerHTML = matches.map(c => `<div onclick="_recClienteSeleccionar(${c.id})" style="padding:.4rem .6rem;cursor:pointer;border-bottom:1px solid var(--gray-100)" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
        ${escapeHtml(c.alias || c.nombre)}
       </div>`).join('');
  }
  sug.style.display = 'block';
}
function _recClienteSeleccionar(id) {
  const c = DB.clientes.find(x => x.id === id);
  const sel = document.getElementById('rec-cliente');
  const buscar = document.getElementById('rec-cliente-buscar');
  sel.innerHTML = c ? `<option value="${c.id}">${escapeHtml(c.nombre)}</option>` : '';
  if (sel) sel.value = id;
  if (buscar) buscar.value = c ? (c.alias || c.nombre) : '';
  const sug = document.getElementById('rec-cliente-sugerencias'); if (sug) sug.style.display = 'none';
}

async function guardarRecordatorio() {
  const clienteId = parseInt(document.getElementById('rec-cliente').value) || null;
  const tipo = document.getElementById('rec-tipo').value.trim();
  const cantidad = parseInt(document.getElementById('rec-cantidad').value) || 0;
  const fechaEntrega = document.getElementById('rec-fecha-entrega').value || today();
  const obs = document.getElementById('rec-obs').value.trim();

  if (!clienteId) { alert('Selecciona un cliente.'); return; }
  if (!tipo) { alert('Ingresa el tipo (ej: botella grande, jaba...).'); return; }
  if (cantidad <= 0) { alert('Ingresa una cantidad válida.'); return; }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  const data = { clienteId, tipo, cantidad, fechaEntrega, obs, sedeId: sedeAdminEfectiva() };
  let _final, _payloadEscritura;
  if (editingRecordatorioId) {
    const idx = DB.recordatorios.findIndex(x => x.id === editingRecordatorioId);
    if (idx >= 0) DB.recordatorios[idx] = { ...DB.recordatorios[idx], ...data };
    _final = DB.recordatorios[idx];
    _payloadEscritura = data; // al editar, nunca toca estado/fechaDevolucion
  } else {
    _final = { id: getId(), ...data, estado: 'pendiente', fechaDevolucion: null, usuario: currentUser };
    DB.recordatorios.push(_final);
    // CRITICO: al crear, la escritura real DEBE incluir estado/fechaDevolucion/usuario — antes
    // se escribia solo "data" (sin esos 3 campos), asi que el documento real en Firestore
    // quedaba sin "estado" definido. El listener sincronizaba ese vacio de vuelta a memoria
    // local, y renderRecordatorios() interpretaba "no es 'pendiente'" como "debe ser
    // devuelto" — mostrando cada recordatorio nuevo como ya devuelto sin que nadie lo marcara.
    _payloadEscritura = _final;
  }
  try {
    // merge:true — nunca sobrescribe el documento completo basado en memoria local, mismo
    // criterio ya aplicado en todo el resto del sistema tras la auditoria de fiados.
    await setDocM(docM(dbModular, 'recordatorios', String(_final.id)), _payloadEscritura, { merge: true });
  } catch (e) {
    alert('⚠️ No se pudo guardar: ' + (e.message || 'intenta de nuevo'));
    return;
  }
  cerrarModal('modal-recordatorio');
  renderRecordatorios();
}

// Marcar como devuelto — accion simple y de bajo riesgo (no hay ningun valor que se acumule
// entre operaciones concurrentes, solo un estado que pasa de pendiente a devuelto una vez).
async function marcarDevuelto(id) {
  const r = DB.recordatorios.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Confirmar que "${r.tipo}" (x${r.cantidad}) de ${getClienteNombre(r.clienteId)} fue devuelto?`)) return;
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const fechaDevolucion = today();
  try {
    await setDocM(docM(dbModular, 'recordatorios', String(id)), { estado: 'devuelto', fechaDevolucion }, { merge: true });
  } catch (e) {
    alert('⚠️ No se pudo actualizar: ' + (e.message || 'intenta de nuevo'));
    return;
  }
  r.estado = 'devuelto';
  r.fechaDevolucion = fechaDevolucion;
  renderRecordatorios();
}

function eliminarRecordatorio(id) {
  if (!confirm('¿Eliminar este recordatorio? Esta acción no se puede deshacer.')) return;
  DB.recordatorios = DB.recordatorios.filter(x => x.id !== id);
  if (dbModular) deleteDocM(docM(dbModular, 'recordatorios', String(id))).catch(e => console.warn('No se pudo borrar recordatorios/'+id, e)); // [SDK modular]
  renderRecordatorios();
}

function limpiarFiltrosRecordatorios() {
  document.getElementById('rec-buscar').value = '';
  document.getElementById('rec-filtro-tipo').value = '';
  document.getElementById('rec-filtro-estado').value = 'pendiente';
  renderRecordatorios();
}

function renderRecordatorios() {
  const tbody = document.getElementById('rec-tbody');
  if (!tbody) return;
  const qCliente = _norm((document.getElementById('rec-buscar')?.value || '').trim());
  const qTipo = _norm((document.getElementById('rec-filtro-tipo')?.value || '').trim());
  const fEstado = document.getElementById('rec-filtro-estado')?.value || '';

  let items = (DB.recordatorios || []).filter(r => {
    if (fEstado && r.estado !== fEstado) return false;
    if (qTipo && !_norm(r.tipo||'').includes(qTipo)) return false;
    if (qCliente) {
      const nombre = _norm(getClienteNombre(r.clienteId) || '');
      if (!nombre.includes(qCliente)) return false;
    }
    return true;
  }).sort((a,b) => (b.fechaEntrega||'').localeCompare(a.fechaEntrega||''));

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:1.5rem">Sin recordatorios que coincidan con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(r => `
    <tr>
      <td>${getClienteNombre(r.clienteId) || '—'}</td>
      <td>${r.tipo}</td>
      <td>${r.cantidad}</td>
      <td>${r.fechaEntrega || '—'}</td>
      <td>${r.estado === 'pendiente' ? '<span style="color:var(--warning);font-weight:700">⏳ Pendiente</span>' : '<span style="color:var(--success);font-weight:700">✅ Devuelto</span>'}</td>
      <td>${r.fechaDevolucion || '—'}</td>
      <td style="white-space:nowrap">
        ${r.estado === 'pendiente' ? `<button type="button" class="btn btn-xs btn-primary" onclick="marcarDevuelto(${r.id})">Marcar devuelto</button>` : ''}
        <button type="button" class="btn btn-xs btn-outline" onclick="abrirModalRecordatorio(${r.id})">✏️</button>
        <button type="button" class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarRecordatorio(${r.id})">🗑️</button>
      </td>
    </tr>
  `).join('');
}
