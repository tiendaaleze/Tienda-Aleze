// ===================== CLIENTES =====================
// CRITICO: en movil, wa.me abre la app nativa de WhatsApp directamente — comportamiento
// correcto, no se toca. En PC/desktop, wa.me deja que el sistema operativo decida como
// abrirlo (a veces app de escritorio, a veces navegador, de forma ambigua e impredecible) —
// forzar siempre WhatsApp Web ahi elimina esa pregunta confusa. El usuario sigue teniendo que
// tocar "Enviar" dentro de WhatsApp una vez que se abre — eso no se puede saltar, es una
// restriccion del propio WhatsApp (para evitar spam automatizado), no de este sistema.
function _waEsMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function _waUrl(tel, texto) {
  const telLimpio = tel ? String(tel).replace(/\s/g, '') : '';
  if (_waEsMobile()) {
    return telLimpio ? `https://wa.me/51${telLimpio}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
  }
  return telLimpio ? `https://web.whatsapp.com/send?phone=51${telLimpio}&text=${encodeURIComponent(texto)}` : `https://web.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

let editingCliId = null;

function verHistorialCliente(id) {
  navigate('historial-ventas');
  const el = document.getElementById('hv-buscar');
  if (el) {
    const c = DB.clientes.find(x => x.id === id);
    el.value = c ? (c.alias || c.nombre) : '';
    renderHistorialVentas();
  }
}

function renderClientes() {
  const buscar = (document.getElementById('cli-buscar')?.value || '').toLowerCase();
  const lista = buscar ? DB.clientes.filter(c =>
    _norm(c.nombre||'').includes(_norm(buscar)) ||
_norm(c.alias||'').includes(_norm(buscar)) ||
_norm(c.tel||'').includes(_norm(buscar))
  ) : DB.clientes;
  document.getElementById('cli-tbody').innerHTML = lista.map(c => { const _deudaSede = clienteDeudaMonto(c); return `<tr>
    <td><strong>${escapeHtml(c.nombre) || 'Cliente sin nombre'}</strong></td>
    <td><span class="badge badge-blue">${escapeHtml(c.alias)||'-'}</span></td>
    <td>${escapeHtml(c.tel)||'-'}</td>
    <td>${c.cumple ? formatDate(c.cumple) : '-'}</td>
   <td><span class="badge badge-gold">⭐ ${c.puntos||0} pts</span></td>
    <td><strong>${sol(c.total||0)}</strong></td>
    <td style="color:${_deudaSede>0?'var(--danger)':'var(--accent)'}"><strong>${_deudaSede > 0 ? sol(_deudaSede) : '✅ Al día'}</strong></td>
    <td style="white-space:nowrap">
      <button class="btn btn-outline btn-xs" onclick="verHistorialCliente(${c.id})">📋</button>
      <button class="btn btn-outline btn-xs" onclick="editarCliente(${c.id})">✏️ Editar</button>
      ${currentRole === 'admin' ? `<button class="btn btn-outline btn-xs" onclick="asignarPuntosManual(${c.id})" title="Asignar puntos manualmente">⭐+</button>` : ''}
      <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarCliente(${c.id})">🗑️</button>
    </td>
  </tr>`; }).join('') || '<tr><td colspan="8" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin clientes</td></tr>';
}

function abrirModalCliente() {
  editingCliId = null;
  document.getElementById('cli-modal-titulo').textContent = 'Nuevo Cliente';
  ['cli-nombre','cli-alias','cli-tel','cli-dir','cli-cumple'].forEach(id => document.getElementById(id).value = '');
  abrirModal('modal-cliente');
}

function editarCliente(id) {
  editingCliId = id;
  const c = DB.clientes.find(x => x.id === id);
  document.getElementById('cli-modal-titulo').textContent = 'Editar Cliente';
  document.getElementById('cli-nombre').value = c.nombre;
  document.getElementById('cli-alias').value = c.alias || '';
  document.getElementById('cli-tel').value = c.tel || '';
  document.getElementById('cli-dir').value = c.dir || '';
  document.getElementById('cli-cumple').value = c.cumple || '';
  abrirModal('modal-cliente');
}

function guardarCliente() {
  const nombre = document.getElementById('cli-nombre').value.trim();
  if (!nombre) { alert('Ingresa el nombre'); return; }
  const tel = document.getElementById('cli-tel').value.trim();
  // Peru: los celulares son 9 digitos, no 7 — evita aceptar numeros incompletos que despues
  // no sirven para nada (ni para ubicar al cliente, ni para escribirle por WhatsApp).
  if (tel && tel.replace(/\D/g,'').length !== 9) { alert('El teléfono debe tener 9 dígitos (formato de celular en Perú).'); return; }
  const data = { nombre, alias: document.getElementById('cli-alias').value.trim(), tel, dir: document.getElementById('cli-dir').value, cumple: document.getElementById('cli-cumple').value };
  if (editingCliId) {
    const c = DB.clientes.find(x => x.id === editingCliId);
    Object.assign(c, data);
    _guardarClienteDirecto(c.id, data, false);
  } else {
    // Buscar por telefono ANTES de crear — evita duplicar el mismo cliente por error.
    const _existente = tel ? DB.clientes.find(x => (x.tel||'').replace(/\D/g,'') === tel.replace(/\D/g,'')) : null;
    if (_existente && !confirm(`Ya existe un cliente con este teléfono: "${_existente.nombre}".\n\n¿Confirmas que es una persona distinta y quieres crear un registro nuevo de todas formas?`)) {
      return;
    }
    const nuevo = _envolverCliente({ id: getId(), ...data, compras: 0, total: 0, deuda: 0 });
    DB.clientes.push(nuevo);
    _guardarClienteDirecto(nuevo.id, { id: nuevo.id, ...data, compras: 0, total: 0, deuda: 0, puntos: 0 }, true);
  }
  cerrarModal('modal-cliente');
  renderClientes();
  updatePosClientes();
  updateAlertCount();
}

function eliminarCliente(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar clientes.'); return; }
  const c = DB.clientes.find(x => x.id === id);
  const _deudaTotal = c ? clienteDeudaMonto(c) : 0;
  if (c && clienteTieneDeuda(c)) { alert('Este cliente tiene deuda pendiente de S/ ' + sol(_deudaTotal) + '. Salda los fiados antes de eliminarlo.'); return; }
  if (!confirm('¿Eliminar cliente?')) return;
  DB.clientes = DB.clientes.filter(c => c.id !== id);
  if (dbModular) deleteDocM(docM(dbModular, 'clientes', String(id))).catch(e => console.warn('No se pudo borrar clientes/'+id, e)); // [SDK modular]
  fbGuardar();
  renderClientes();
  updatePosClientes();
}

// ===================== FIADOS =====================
function limpiarFiltrosFiados() {
  document.getElementById('fi-desde').value = '';
  document.getElementById('fi-hasta').value = '';
  document.getElementById('fi-estado').value = '';
  document.getElementById('fi-cliente').value = '';
  renderFiados();
}

function renderFiados() {
  const desde    = document.getElementById('fi-desde')?.value || '';
  const hasta    = document.getElementById('fi-hasta')?.value || '';
  const estado   = document.getElementById('fi-estado')?.value || '';
  const cliFilter = parseInt(document.getElementById('fi-cliente')?.value) || 0;

  // Por sede, mismo criterio que el resto — solo la LISTA que se ve (de donde se originó la
  // deuda). Cobrar, editar, o el mensaje de WhatsApp de un cliente puntual siguen sin filtrar
  // por sede más abajo en el archivo — pagar una deuda no depende de en qué sede se originó.
  const _sedeF = sedeAdminEfectiva();
  const _fiadosSede = DB.fiados.filter(f => (f.sedeId||'principal') === _sedeF);

  // Poblar selector de clientes — respeta el filtro de estado actual (por defecto "pendiente"),
  // así no lista clientes que la tarjeta de abajo ya está ocultando.
  const selCli = document.getElementById('fi-cliente');
  if (selCli) {
    const valorActual = selCli.value;
    selCli.innerHTML = '<option value="">Todos los clientes</option>';
    let fiadosParaSelector = _fiadosSede;
    if (estado === 'pendiente') fiadosParaSelector = fiadosParaSelector.filter(f => fiadoPendiente(f));
    if (estado === 'pagado')    fiadosParaSelector = fiadosParaSelector.filter(f => !fiadoPendiente(f));
    const cidsConFiados = [...new Set(fiadosParaSelector.map(f => f.clienteId))];
    cidsConFiados.forEach(cid => {
      const cli = DB.clientes.find(c => c.id === cid);
      if (cli) selCli.innerHTML += `<option value="${cli.id}">${cli.alias||cli.nombre}</option>`;
    });
    selCli.value = valorActual;
  }

  const porCliente = {};
  _fiadosSede.forEach(f => {
    if (!porCliente[f.clienteId]) porCliente[f.clienteId] = [];
    porCliente[f.clienteId].push(f);
  });

  let clienteIds = Object.keys(porCliente).map(Number);

  // Filtro por cliente
  if (cliFilter) clienteIds = clienteIds.filter(cid => cid === cliFilter);

  // Filtro por estado
  if (estado === 'pendiente') clienteIds = clienteIds.filter(cid => porCliente[cid].some(f => fiadoPendiente(f)));
  if (estado === 'pagado') clienteIds = clienteIds.filter(cid => porCliente[cid].every(f => !fiadoPendiente(f)));

  // Filtro por fecha — aplica sobre fiados individuales
  if (desde || hasta) {
    clienteIds = clienteIds.filter(cid => porCliente[cid].some(f =>
      (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta)
    ));
  }

  const totalDeuda = _fiadosSede.reduce((s, f) => s + fiadoMontoPendiente(f), 0);
  const clientesConDeuda = [...new Set(_fiadosSede.map(f => f.clienteId))].filter(cid =>
    _fiadosSede.filter(f => f.clienteId === cid).some(f => fiadoPendiente(f))
  ).length;
  const mayor = [...new Set(_fiadosSede.map(f => f.clienteId))].reduce((m, cid) => {
    const d = _fiadosSede.filter(f => f.clienteId === cid).reduce((s, f) => s + fiadoMontoPendiente(f), 0);
    return Math.max(m, d);
  }, 0);
  document.getElementById('fiados-total').textContent = sol(totalDeuda);
  document.getElementById('fiados-clientes').textContent = clientesConDeuda;
  document.getElementById('fiados-mayor').textContent = sol(mayor);

  if (clienteIds.length === 0) {
    document.getElementById('fiados-list').innerHTML = '<p style="color:var(--gray-500)">Sin fiados que coincidan con los filtros</p>';
    return;
  }

  const _hace30dias = new Date(); _hace30dias.setDate(_hace30dias.getDate() - 30);
  const _hace30diasStr = _hace30dias.toISOString().split('T')[0];
  document.getElementById('fiados-list').innerHTML = clienteIds.map(cid => {
    const cli = DB.clientes.find(c => c.id === cid);
    const nombre = cli ? (cli.alias || cli.nombre) : 'Anónimo';
    const tel = cli ? cli.tel : '';
    let fiados = porCliente[cid];
    if (desde || hasta) fiados = fiados.filter(f => ((!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta)) || fiadoPendiente(f));
    else fiados = fiados.filter(f => f.fecha >= _hace30diasStr || fiadoPendiente(f));
    const totalCli = Math.round(fiados.reduce((s, f) => s + f.total, 0) * 100) / 100;
    const pagadoCli = Math.round(fiados.reduce((s, f) => s + f.pagado, 0) * 100) / 100;
    const pendienteCli = Math.round((totalCli - pagadoCli) * 100) / 100;
    const detalleId = 'fiado-detalle-' + cid;
    const detalle = [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
      const pend = fiadoMontoPendiente(f);
      return `<div style="border-left:3px solid var(--warning);padding:.5rem .75rem;margin-bottom:.5rem;background:white;border-radius:0 6px 6px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
          <span style="font-size:.75rem;color:var(--gray-500)">${formatDate(f.fecha)} ${f.hora||''}</span>
          <span style="font-size:.82rem;font-weight:700;color:${pend>0?'var(--danger)':'var(--accent)'}">
            ${pend > 0 ? sol(pend)+' pendiente' : '✅ Pagado'}
          </span>
        </div>
        <div style="font-size:.8rem;margin-bottom:.3rem">
          ${f.items.map(i => `${escapeHtml(i.nombre)} x${i.cant} = ${sol(subtotalItemCarrito(i))}`).join(' · ')}
        </div>
        <div style="font-size:.72rem;color:var(--gray-500)">Total: ${sol(f.total)} | Pagado: ${sol(f.pagado)}</div>
        <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap">
          ${pend > 0 ? `<button class="btn btn-accent btn-xs" onclick="abrirPagoFiado(${f.id})">💰 Registrar pago</button>` : ''}
          ${currentRole === 'admin' && pend > 0 ? `<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="confirmarEliminarFiado(${f.id})">🗑️ Eliminar</button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="fiado-card" style="margin-bottom:.75rem">
      <div class="flex-between" style="cursor:pointer" onclick="toggleFiadoDetalle('${detalleId}')">
        <div>
          <strong style="font-size:1rem">${escapeHtml(nombre)}</strong>
          ${tel ? `<span style="font-size:.72rem;color:var(--gray-400);margin-left:.5rem">📞 ${escapeHtml(tel)}</span>` : ''}
          <span style="font-size:.75rem;color:var(--gray-500);margin-left:.5rem">${fiados.length} venta(s)</span>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:.75rem">
          <div>
          <div style="font-weight:700;color:${pendienteCli>0?'var(--danger)':'var(--accent)'};font-size:1rem">${pendienteCli>0?sol(pendienteCli)+' pendiente':'✅ Pagado'}</div>
            <div style="font-size:.72rem;color:var(--gray-500)">Total: ${sol(totalCli)} | Pagado: ${sol(pagadoCli)}</div>
          </div>
          <span id="arr-${detalleId}" style="font-size:1.1rem;color:var(--gray-400)">▼</span>
        </div>
      </div>
      <div id="${detalleId}" style="display:none;margin-top:.75rem">
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem;padding:.5rem;background:var(--gray-50);border-radius:8px">
          <select class="form-control" id="fi-tipo-${cid}" style="width:150px;font-size:.78rem" onchange="renderDetalleFiado(${cid})">
            <option value="todo">Todo</option>
            <option value="pendiente">Solo pendientes</option>
            <option value="pagado">Solo pagados</option>
          </select>
          <input type="date" class="form-control" id="fi-int-desde-${cid}" value="${_hace30diasStr}" style="width:140px;font-size:.78rem" onchange="renderDetalleFiado(${cid})"/>
          <input type="date" class="form-control" id="fi-int-hasta-${cid}" style="width:140px;font-size:.78rem" onchange="renderDetalleFiado(${cid})"/>
          <button class="btn btn-outline btn-xs" onclick="limpiarFiltrosInternosFiado(${cid})">✕</button>
        </div>
        <div id="fi-detalle-content-${cid}">${detalle}</div>
        ${(cli && cli.notasFiado && cli.notasFiado.length) ? `
        <div style="margin-top:.75rem;padding-top:.5rem;border-top:1px dashed var(--gray-300)">
          <div style="font-size:.75rem;font-weight:700;color:var(--gray-500);margin-bottom:.4rem">📝 Notas (solo informativas — no afectan la deuda)</div>
          ${cli.notasFiado.map(n => `<div style="display:flex;justify-content:space-between;align-items:center;background:var(--gray-50);border-radius:6px;padding:.4rem .6rem;margin-bottom:.3rem;font-size:.8rem">
            <span>${n.desc}${n.monto ? ` <span style="color:var(--gray-400)">(ref. ${sol(n.monto)})</span>` : ''} <span style="color:var(--gray-400);font-size:.72rem">— ${formatDate(n.fecha)}</span></span>
            <span style="display:flex;gap:.3rem">
              <button onclick="editarNotaFiado(${cid},${n.id})" style="background:none;border:none;color:var(--gray-500);cursor:pointer">✏️</button>
              <button onclick="eliminarNotaFiado(${cid},${n.id})" style="background:none;border:none;color:var(--danger);cursor:pointer">✕</button>
            </span>
          </div>`).join('')}
        </div>` : ''}
      </div>
      <div style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--warning);text-align:right;display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn btn-outline btn-sm" onclick="abrirPagoGlobal(${cid})">💳 Pago global</button>
        <button class="btn btn-outline btn-sm" onclick="compartirResumenFiadoCliente(${cid})">💬 WhatsApp resumen</button>
        <button class="btn btn-outline btn-sm" onclick="abrirHistorialCliente(${cid},event)">📋 Ver historial completo</button>
      </div>
    </div>`;
 }).join('');
  _fiadosAbiertos.forEach(id => {
    const el = document.getElementById(id);
    const arr = document.getElementById('arr-' + id);
    if (el) el.style.display = 'block';
    if (arr) arr.textContent = '▲';
  });
}

function limpiarFiltrosInternosFiado(cid) {
  document.getElementById('fi-tipo-' + cid).value = 'todo';
  document.getElementById('fi-int-desde-' + cid).value = '';
  document.getElementById('fi-int-hasta-' + cid).value = '';
  renderDetalleFiado(cid);
}

function renderDetalleFiado(cid) {
  const tipo  = document.getElementById('fi-tipo-' + cid)?.value || 'todo';
  const desde = document.getElementById('fi-int-desde-' + cid)?.value || '';
  const hasta = document.getElementById('fi-int-hasta-' + cid)?.value || '';
  let fiados  = DB.fiados.filter(f => f.clienteId === cid);
  // Un pendiente nunca desaparece por el filtro de fecha (sigue siendo deuda real) — el
  // filtro de fecha solo acota lo YA PAGADO.
  if (desde) fiados = fiados.filter(f => f.fecha >= desde || fiadoPendiente(f));
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta || fiadoPendiente(f));
  if (tipo === 'pendiente') fiados = fiados.filter(f => fiadoPendiente(f));
  if (tipo === 'pagado')    fiados = fiados.filter(f => !fiadoPendiente(f));
  const html = [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
    const pend = fiadoMontoPendiente(f);
    return `<div style="border-left:3px solid var(--warning);padding:.5rem .75rem;margin-bottom:.5rem;background:white;border-radius:0 6px 6px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
        <span style="font-size:.75rem;color:var(--gray-500)">${formatDate(f.fecha)} ${f.hora||''}</span>
        <span style="font-size:.82rem;font-weight:700;color:${pend>0?'var(--danger)':'var(--accent)'}">
          ${pend > 0 ? sol(pend)+' pendiente' : '✅ Pagado'}
        </span>
      </div>
      <div style="font-size:.8rem;margin-bottom:.3rem">
        ${f.items.map(i => `${escapeHtml(i.nombre)} x${i.cant} = ${sol(subtotalItemCarrito(i))}`).join(' · ')}
      </div>
      <div style="font-size:.72rem;color:var(--gray-500)">Total: ${sol(f.total)} | Pagado: ${sol(f.pagado)}</div>
      <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap">
        ${pend > 0 ? `<button class="btn btn-accent btn-xs" onclick="abrirPagoFiado(${f.id})">💰 Registrar pago</button>` : ''}
        ${currentRole === 'admin' && pend > 0 ? `<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="confirmarEliminarFiado(${f.id})">🗑️ Eliminar</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--gray-400);font-size:.82rem;padding:.5rem">Sin registros para los filtros seleccionados</p>';
  document.getElementById('fi-detalle-content-' + cid).innerHTML = html;
}

// ── Conceptos adicionales en fiados: para lo que se vende fuera del catálogo (arreglos a
// pedido, preparaciones puntuales) — se anota como texto libre + monto, suma al total del
// fiado para el cobro y el WhatsApp, pero vive en un campo APARTE de "items". Rentabilidad,
// reportes y puntos de fidelización solo miran "items" — nunca tocan esto, tal como se pidió.
// No aplica a tienda pública — es exclusivo del flujo interno de Fiados.
// ── Notas de fiado: PURA información, cero acciones ──────────────────────────────────────
// A diferencia del diseño anterior (retirado tras probarlo): esto NO suma al total de ningún
// fiado, NO se puede pagar, NO llega a caja, y NO aparece en los mensajes de WhatsApp
// automáticos — el staff la copia a mano si quiere avisarle al cliente. Vive en el CLIENTE
// (no en un fiado específico), porque no tiene relación con ningún ciclo de pago.
function agregarNotaFiado() {
  const query = prompt('Nombre del cliente (o parte del nombre):');
  if (!query || !query.trim()) return;
  const matches = DB.clientes.filter(c => _norm(c.nombre).includes(_norm(query)) || _norm(c.alias||'').includes(_norm(query)));
  let cli;
  if (matches.length === 0) { alert('No se encontró ningún cliente con ese nombre. Créalo primero en Clientes.'); return; }
  if (matches.length === 1) {
    cli = matches[0];
  } else {
    const idx = parseInt(prompt('Varios clientes coinciden:\n' + matches.map((c,i)=>`${i+1}. ${c.alias||c.nombre}`).join('\n') + '\n\nEscribe el número:'));
    if (!idx || idx < 1 || idx > matches.length) return;
    cli = matches[idx-1];
  }
  const desc = prompt(`Nota sobre ${cli.alias||cli.nombre} (describe completo, ej: "Arreglo floral con rosas y girasoles a pedido"):`);
  if (!desc || !desc.trim()) return;
  const montoRaw = prompt('Monto de referencia (S/) — opcional, solo para recordar cuánto cobrar, no se suma a nada:');
  const monto = parseFloat(montoRaw);

  if (!cli.notasFiado) cli.notasFiado = [];
  cli.notasFiado.push({ id: getId(), desc: desc.trim(), monto: (!isNaN(monto) && monto > 0) ? Math.round(monto*100)/100 : null, fecha: today() });
  fbSincronizarClienteCampo(cli.id, 'notasFiado', cli.notasFiado);
  renderFiados();
  alert(`✅ Nota guardada para ${cli.alias||cli.nombre}. No afecta su deuda ni su caja — es solo para recordarlo.`);
}

function editarNotaFiado(clienteId, notaId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  const nota = cli?.notasFiado?.find(n => n.id === notaId);
  if (!nota) return;
  const desc = prompt('Editar nota:', nota.desc);
  if (desc === null || !desc.trim()) return;
  const montoRaw = prompt('Monto de referencia (S/) — opcional:', nota.monto ?? '');
  const monto = parseFloat(montoRaw);
  nota.desc = desc.trim();
  nota.monto = (!isNaN(monto) && monto > 0) ? Math.round(monto*100)/100 : null;
  fbSincronizarClienteCampo(cli.id, 'notasFiado', cli.notasFiado);
  renderFiados();
}

function eliminarNotaFiado(clienteId, notaId) {
  const cli = DB.clientes.find(c => c.id === clienteId);
  if (!cli || !cli.notasFiado) return;
  if (!confirm('¿Eliminar esta nota?')) return;
  cli.notasFiado = cli.notasFiado.filter(n => n.id !== notaId);
  fbSincronizarClienteCampo(cli.id, 'notasFiado', cli.notasFiado);
  renderFiados();
}

function compartirResumenFiadoCliente(cid) {
  const cli   = DB.clientes.find(c => c.id === cid);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const tel   = cli && cli.tel ? cli.tel.replace(/\s/g,'') : '';
  const tipo  = document.getElementById('fi-tipo-' + cid)?.value || 'todo';
  const desde = document.getElementById('fi-int-desde-' + cid)?.value || '';
  const hasta = document.getElementById('fi-int-hasta-' + cid)?.value || '';
  // Por sede: un vendedor de Sede II no debe mandar ni ver deuda que el cliente generó en
  // Sede I — son clientes de confianza de un local, no necesariamente conocidos en el otro.
  const _sedeCRF = sedeAdminEfectiva();
  let fiados  = DB.fiados.filter(f => f.clienteId === cid && (f.sedeId||'principal') === _sedeCRF);
  // Un pendiente nunca desaparece por el filtro de fecha (sigue siendo deuda real) — el
  // filtro de fecha solo acota lo YA PAGADO.
  if (desde) fiados = fiados.filter(f => f.fecha >= desde || fiadoPendiente(f));
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta || fiadoPendiente(f));
  if (tipo === 'pendiente') fiados = fiados.filter(f => fiadoPendiente(f));
  if (tipo === 'pagado')    fiados = fiados.filter(f => !fiadoPendiente(f));
  const totalPend = Math.round(fiados.reduce((s, f) => s + fiadoMontoPendiente(f), 0) * 100) / 100;
  let msg = `Hola ${nombre}, su resumen de fiados en *${DB.config.nombre||'Tienda Aleze'}*:\n`;
  if (desde || hasta) msg += `📅 Período: ${desde ? formatDate(desde) : 'inicio'} al ${hasta ? formatDate(hasta) : 'hoy'}\n`;
  msg += '\n';
  fiados.forEach(f => {
    const pend = fiadoMontoPendiente(f);
    msg += `📌 ${formatDate(f.fecha)}: ${f.items.map(i => i.nombre + ' x' + i.cant).join(', ')} → ${sol(f.total)}`;
    msg += pend > 0 ? ` _(pendiente: ${sol(pend)})_\n` : ` ✅\n`;
  });
  msg += `\n*Total pendiente: ${sol(totalPend)}*\nGracias 🙏`;
  const url = _waUrl(tel, msg);
  window.open(url, '_blank');
}

function abrirPagoGlobal(cid) {
  const cli = DB.clientes.find(c => c.id === cid);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const _sedeAPG = sedeAdminEfectiva();
 const pendienteTotal = Math.round(DB.fiados.filter(f => f.clienteId === cid && (f.sedeId||'principal') === _sedeAPG).reduce((s,f) => s + fiadoMontoPendiente(f), 0) * 100) / 100;
  if (pendienteTotal <= 0) { alert('Este cliente no tiene deuda pendiente.'); return; }
  const monto = parseFloat(prompt(`Pago global para ${nombre}\nDeuda total: ${sol(pendienteTotal)}\n\nIngresa el monto a pagar:`));
  if (!monto || isNaN(monto) || monto <= 0) return;
  if (monto > pendienteTotal) { alert('El monto supera la deuda total de ' + sol(pendienteTotal)); return; }
  const _metodosPago = ['Efectivo','Yape','Plin','QR','Link de pago','Tarjeta POS','Tarjeta POS Móvil','Transferencia'];
  const _idxMetodo = parseInt(prompt('Método de pago:\n' + _metodosPago.map((m,i)=>`${i+1}. ${m}`).join('\n'), '1'));
  const metodo = (_idxMetodo >= 1 && _idxMetodo <= _metodosPago.length) ? _metodosPago[_idxMetodo-1] : 'Efectivo';
  ejecutarPagoGlobal(cid, monto, metodo);
}

// ── Asigna un pago a items específicos del fiado (más baratos primero) y devuelve el costo real cubierto ──
// Mismo criterio en confirmarPagoFiado() y ejecutarPagoGlobal() — así el costo reconocido en
// Dashboard/Capital coincide exactamente con qué se pagó, no una proporción uniforme sobre todo el fiado.
function _asignarPagoAItems(fiado, monto) {
  const itemsOrdenados = [...(fiado.items||[])].sort((a,b) => subtotalItemCarrito(a) - subtotalItemCarrito(b));
  let saldoItem = monto;
  let costo = 0;
  itemsOrdenados.forEach(i => {
    if (saldoItem <= 0) return;
    const totalItem = subtotalItemCarrito(i);
    const pendItem = totalItem - (i.pagado || 0);
    if (pendItem <= 0) return;
    const cubierto = Math.min(saldoItem, pendItem);
    i.pagado = (i.pagado || 0) + cubierto;
    saldoItem -= cubierto;
    const fraccionItem = totalItem > 0 ? cubierto / totalItem : 0;
    costo += (i.costoUnitario || 0) * i.cant * fraccionItem;
  });
  return Math.round(costo * 10000) / 10000;
}

async function ejecutarPagoGlobal(cid, montoTotal, metodo) {
  metodo = metodo || 'Efectivo';
  const _sedeEPG = sedeAdminEfectiva();
  const fiadosLocal = DB.fiados.filter(f => f.clienteId === cid && (f.sedeId||'principal') === _sedeEPG && fiadoPendiente(f)).sort((a,b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id);

  // CRITICO: runTransaction en vez de writeBatch — un batch es atomico DENTRO de una sola
  // llamada, pero no protege contra que un pago individual (confirmarPagoFiado) o otro pago
  // global casi simultaneo sobre el MISMO cliente lean el mismo estado viejo y se pisen entre
  // si. Esta es la funcion que coincide exactamente con el incidente real reportado (pago
  // global parcial perdido) — el fix anterior de atomicidad de lote ayudo con otro problema,
  // pero no con este: la lectura seguia siendo de memoria local, potencialmente vieja.
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()

  let _r;
  try {
    _r = await runTransactionM(dbModular, async (tx) => {
      // FASE 1 — leer TODOS los fiados candidatos del servidor primero (regla de Firestore:
      // todas las lecturas de una transaccion deben ocurrir antes que cualquier escritura).
      const _snapsFiados = [];
      for (const f of fiadosLocal) {
        const ref = docM(dbModular, 'fiados', String(f.id));
        const snap = await tx.get(ref); // lectura garantizada real del servidor, nunca cache
        if (snap.exists()) _snapsFiados.push({ ref, data: snap.data() }); // en modular, exists es un METODO
      }

      // FASE 2 — calcular y escribir usando los valores REALES del servidor, nunca los de
      // memoria local (que podrian estar desactualizados si algo mas ya toco estos fiados).
      let saldo = montoTotal;
      const _cambiosLocales = [];
      const _hvPagosGlobal = [];
      for (const { ref, data: fServidor } of _snapsFiados) {
        if (saldo <= 0) break;
        const pendFiado = Math.max(0, Math.round(((fServidor.total||0) - (fServidor.pagado||0)) * 100) / 100);
        if (pendFiado <= 0) continue; // ya se habia pagado completo entre medio, saltar
        const montoPagadoEsteFiado = Math.min(saldo, pendFiado);
        // _asignarPagoAItems modifica fServidor.items[] como efecto secundario — seguro
        // dentro de la transaccion, es puramente sincrona y sin llamadas externas.
        const costoAsociado = _asignarPagoAItems(fServidor, montoPagadoEsteFiado);
        const _fPagoEntry = { fecha: today(), hora: nowTime(), cajero: currentUser, monto: montoPagadoEsteFiado, tipo: 'global' };
        const _fPagado = Math.round(((fServidor.pagado||0) + montoPagadoEsteFiado) * 100) / 100;
        const _fEstado = (Math.round(((fServidor.total||0) - _fPagado) * 100) / 100) <= 0 ? 'pagado' : 'pendiente';
        tx.set(ref, { ...fServidor, pagado: _fPagado, pagos: [...(fServidor.pagos||[]), _fPagoEntry], estado: _fEstado });
        saldo = Math.round((saldo - montoPagadoEsteFiado) * 100) / 100;
        const _entry = { id: getId(), fecha: today(), hora: nowTime(), origen: 'pago_fiado', estado: 'completado', clienteId: cid, fiadoId: fServidor.id, total: montoPagadoEsteFiado, metodo, cajero: currentUser, costoAsociado, sedeId: _sedeEPG };
        tx.set(docM(dbModular, 'ventas', String(_entry.id)), _entry);
        _hvPagosGlobal.push(_entry);
        _cambiosLocales.push({ fiadoId: fServidor.id, _fPagoEntry, _fPagado, _fEstado });
      }

      const _montoRealAplicado = Math.round((montoTotal - saldo) * 100) / 100;
      if (_montoRealAplicado <= 0) {
        throw new Error('No se pudo aplicar el pago — la deuda pendiente ya no coincide (puede que se haya saldado por otro pago mientras tanto). Revisa el estado actualizado del cliente.');
      }

      tx.set(docM(dbModular, 'clientes', String(cid)), { deuda: incrementM(-_montoRealAplicado) }, { merge: true });

      const _movId = getId();
      const _movData = { id:_movId, tipo:'ingreso', desc:`Pago global fiado (${metodo}): ` + getClienteNombre(cid), monto: _montoRealAplicado, hora: nowTime(), fecha: today(), sedeId: _sedeEPG };
      tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

      const _cajaUpdate = { ingresos: incrementM(_montoRealAplicado) };
      if (metodo === 'Efectivo') _cajaUpdate.ingresosEfectivo = incrementM(_montoRealAplicado);
      tx.set(docM(dbModular, 'caja', _sedeEPG), _cajaUpdate, { merge: true });

      return { _cambiosLocales, _hvPagosGlobal, _movData, _montoRealAplicado, _saldoSobrante: saldo };
    });
  } catch (e) {
    alert('⚠️ No se pudo registrar el pago global: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se aplican los cambios en memoria local.
  _r._cambiosLocales.forEach(({ fiadoId, _fPagoEntry, _fPagado, _fEstado }) => {
    const f = DB.fiados.find(x => x.id === fiadoId);
    if (!f) return;
    if (!f.pagos) f.pagos = [];
    f.pagos.push(_fPagoEntry);
    f.pagado = _fPagado;
    f.estado = _fEstado;
  });
  const cli = DB.clientes.find(c => c.id === cid);
  if (cli) {
    _clienteProxySkipSync = true;
    try { _aplicarDeudaLocal(cli, -_r._montoRealAplicado); }
    finally { _clienteProxySkipSync = false; }
  }
  // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
  DB.caja.ingresos += _r._montoRealAplicado;
  if (metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + _r._montoRealAplicado;

  if (!DB.historialVentas) DB.historialVentas = [];
  _r._hvPagosGlobal.forEach(entry => DB.historialVentas.push(entry));
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_r._movData);
  fbGuardar();
  renderFiados();
  updateAlertCount();
  try { renderDashboard(); } catch(e) {}
  try { renderCaja(); } catch(e) {}
  alert('✅ Pago global de ' + sol(_r._montoRealAplicado) + ' registrado correctamente.' + (_r._saldoSobrante > 0 ? '\n\n⚠️ Quedó un saldo de ' + sol(_r._saldoSobrante) + ' sin aplicar — la deuda pendiente cambió durante el proceso.' : ''));
}

function confirmarEliminarFiado(id) {
  const fLocal = DB.fiados.find(x => x.id === id);
  if (!fLocal) return;
  // CRITICO — cierra un hueco real: la lista de Fiados ya filtra por sede, pero eliminar/cobrar
  // no volvia a verificarlo, dejando la puerta abierta a tocar un fiado de la otra sede si se
  // llegaba a el por otro camino (ej. historial de un cliente). Defensa en profundidad — nunca
  // se permite tocar un fiado que no sea de la sede activa, sin importar como se llego hasta el.
  if (currentRole !== 'admin' && (fLocal.sedeId||'principal') !== sedeAdminEfectiva()) {
    alert('⛔ Este fiado pertenece a la otra sede — no se puede modificar desde acá.');
    return;
  }
  const pendLocal = fiadoMontoPendiente(fLocal); // solo decide que texto de prompt mostrar — el monto real se relee dentro de la transaccion
  const opciones = pendLocal > 0
    ? `¿Cómo deseas eliminar este fiado de ${sol(fLocal.total)}?

1. ERROR DE REGISTRO → restaura stock
2. PÉRDIDA/INCOBRABLE → registra en mermas

Escribe 1 o 2:`
    : `¿Eliminar este fiado ya pagado?

Escribe 1 para confirmar:`;
  const resp = prompt(opciones);
  if (!resp) return;
  const opcion = resp.trim();
  if (opcion !== '1' && opcion !== '2') { alert('Opción no válida. No se realizó ningún cambio.'); return; }
  if (opcion === '2' && pendLocal <= 0) { alert('Opción no válida. No se realizó ningún cambio.'); return; }
  _confirmarEliminarFiadoTx(id, opcion);
}

// CRITICO: runTransaction en vez de escrituras independientes — antes, restaurar stock
// (fbIncrementarStock), borrar el fiado (deleteDocM), ajustar la deuda (ajustarDeudaCliente)
// y registrar mermas (fbSincronizarMerma) eran 4 operaciones completamente separadas, sin
// ninguna garantia de que llegaran todas juntas — si una fallaba despues de que otra ya se
// aplico, el sistema quedaba inconsistente (ej. stock restaurado pero el fiado seguia
// existiendo, o viceversa). Ademas, el monto pendiente y los items se leian de memoria local,
// mismo riesgo de desincronizacion ya corregido en confirmarPagoFiado/ejecutarPagoGlobal.
async function _confirmarEliminarFiadoTx(id, opcion) {
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const fiadoRef = docM(dbModular, 'fiados', String(id));
  let _r;
  try {
    _r = await runTransactionM(dbModular, async (tx) => {
      // FASE 1 — lecturas: el fiado real, y (solo si opcion 1) cada producto involucrado.
      const snap = await tx.get(fiadoRef); // lectura garantizada real del servidor
      if (!snap.exists()) throw new Error('Este fiado ya no existe — puede que ya se haya eliminado.'); // en modular, exists es un METODO
      const fServidor = snap.data();
      const pendReal = Math.max(0, Math.round(((fServidor.total||0) - (fServidor.pagado||0)) * 100) / 100);
      const _items = fServidor.items || [];

      let _prodSnaps = [];
      if (opcion === '1') {
        for (const i of _items) {
          const prodRef = docM(dbModular, 'productos', String(i.prodId));
          const prodSnap = await tx.get(prodRef);
          _prodSnaps.push({ item: i, ref: prodRef, existe: prodSnap.exists() });
        }
      }

      // FASE 2 — escrituras, todas juntas.
      if (opcion === '1') {
        _prodSnaps.forEach(({ item, ref, existe }) => {
          if (existe) tx.set(ref, { stock: incrementM(item.cant) }, { merge: true });
        });
        tx.delete(fiadoRef);
        if (pendReal > 0) tx.set(docM(dbModular, 'clientes', String(fServidor.clienteId)), { deuda: incrementM(-pendReal) }, { merge: true });
        return { tipo: 'restaurado', fServidor, pendReal };
      } else {
        // Opcion 2 — mermas proporcionales al saldo REAL pendiente (no al monto local, que
        // podria no reflejar un pago parcial reciente).
        const propPend = fServidor.total > 0 ? pendReal / fServidor.total : 0;
        const _mermasNuevas = [];
        _items.forEach(i => {
          const cantMermaExacta = i.cant * propPend;
          const cantMerma = Math.round(cantMermaExacta * 100) / 100;
          const perdidaMonto = Math.round((i.costoUnitario||0) * cantMermaExacta * 100) / 100;
          if (perdidaMonto <= 0) return;
          const _mermaFI = { id: getId(), prodId: i.prodId, cant: cantMerma, motivo: 'Fiado incobrable', obs: 'Fiado #' + fServidor.id + ' — ' + getClienteNombre(fServidor.clienteId), fecha: today(), usuario: currentUser, sedeId: fServidor.sedeId || 'principal', costoUnitario: i.costoUnitario||0 };
          tx.set(docM(dbModular, 'mermas', String(_mermaFI.id)), _mermaFI);
          _mermasNuevas.push(_mermaFI);
        });
        if (_mermasNuevas.length === 0 && pendReal > 0) {
          const _mermaFISinDetalle = { id: getId(), prodId: null, cant: 0, motivo: 'Fiado incobrable', obs: 'Fiado #' + fServidor.id + ' (saldo, sin detalle por producto) — ' + getClienteNombre(fServidor.clienteId) + ' — Pérdida: ' + sol(pendReal), fecha: today(), usuario: currentUser, sedeId: fServidor.sedeId || 'principal' };
          tx.set(docM(dbModular, 'mermas', String(_mermaFISinDetalle.id)), _mermaFISinDetalle);
          _mermasNuevas.push(_mermaFISinDetalle);
        }
        tx.delete(fiadoRef);
        if (pendReal > 0) tx.set(docM(dbModular, 'clientes', String(fServidor.clienteId)), { deuda: incrementM(-pendReal) }, { merge: true });
        return { tipo: 'merma', fServidor, pendReal, mermas: _mermasNuevas };
      }
    });
  } catch (e) {
    alert('⚠️ No se pudo eliminar el fiado: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se aplica en memoria local.
  DB.fiados = DB.fiados.filter(x => x.id !== id);
  const cli = DB.clientes.find(c => c.id === _r.fServidor.clienteId);
  if (_r.tipo === 'restaurado') {
    (_r.fServidor.items||[]).forEach(i => {
      const prod = DB.productos.find(p => p.id === i.prodId);
      if (prod) prod.stock = Math.max(0, Math.round(((prod.stock||0) + i.cant) * 1000) / 1000);
    });
    if (cli && _r.pendReal > 0) { _clienteProxySkipSync = true; try { _aplicarDeudaLocal(cli, -_r.pendReal); } finally { _clienteProxySkipSync = false; } }
    fbGuardar();
    renderFiados(); renderInventario && renderInventario();
    alert('✅ Fiado eliminado y stock restaurado.');
  } else {
    if (!DB.mermas) DB.mermas = [];
    _r.mermas.forEach(m => DB.mermas.push(m));
    if (cli && _r.pendReal > 0) { _clienteProxySkipSync = true; try { _aplicarDeudaLocal(cli, -_r.pendReal); } finally { _clienteProxySkipSync = false; } }
    fbGuardar();
    renderFiados(); try { renderMermas(); } catch(e) {}
    alert('✅ Fiado eliminado y registrado como merma.');
  }
}

function toggleFiadoDetalle(id) {
  const el = document.getElementById(id);
  const arr = document.getElementById('arr-' + id);
  if (!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if (arr) arr.textContent = open ? '▼' : '▲';
  if (open) _fiadosAbiertos.delete(id); else _fiadosAbiertos.add(id);
}

function abrirPagoFiado(id) {
  editingFiadoId = id;
  const f = DB.fiados.find(x => x.id === id);
  const cli = DB.clientes.find(c => c.id === f.clienteId);
  const pendiente = fiadoMontoPendiente(f);
  document.getElementById('fiado-detalle').innerHTML = `
    <div style="background:var(--gray-50);border-radius:8px;padding:0.75rem;margin-bottom:1rem">
      <strong>${escapeHtml(getClienteNombre(f.clienteId))}</strong>
      ${cli && cli.tel ? `<span style="font-size:.78rem;color:var(--gray-500);margin-left:.5rem">📞 ${escapeHtml(cli.tel)}</span>` : ''}
      <div style="font-size:0.82rem;margin-top:.4rem">
        ${f.items.map(i => `${escapeHtml(i.nombre)} x${i.cant} = ${sol(subtotalItemCarrito(i))}`).join(' · ')}
      </div>
      <div style="font-size:0.85rem;margin-top:.3rem">
        Total: ${sol(f.total)} | Pagado: ${sol(f.pagado)} | <strong style="color:var(--danger)">Pendiente: ${sol(pendiente)}</strong>
      </div>
    </div>`;
  const hist = f.pagos || [];
  const wrap = document.getElementById('fiado-historial-wrap');
  const list = document.getElementById('fiado-historial-list');
  if (hist.length > 0) {
    wrap.style.display = 'block';
    list.innerHTML = hist.map(p => `
      <div style="display:flex;justify-content:space-between;padding:.3rem .5rem;background:var(--gray-50);border-radius:5px;margin-bottom:.25rem">
        <span style="font-size:.78rem">${p.fecha} ${p.hora} — <em>${p.cajero}</em></span>
        <strong style="color:var(--accent);font-size:.78rem">+${sol(p.monto)}</strong>
      </div>`).join('');
  } else {
    wrap.style.display = 'none';
  }
  document.getElementById('fiado-pago-monto').value = '';
  abrirModal('modal-pago-fiado');
}

async function confirmarPagoFiado() {
  const f = DB.fiados.find(x => x.id === editingFiadoId);
  if (!f) return;
  // Mismo criterio que confirmarEliminarFiado — defensa en profundidad, nunca se cobra un
  // fiado que no sea de la sede activa, sin importar como se llego hasta el.
  if (currentRole !== 'admin' && (f.sedeId||'principal') !== sedeAdminEfectiva()) {
    alert('⛔ Este fiado pertenece a la otra sede — no se puede cobrar desde acá.');
    return;
  }
  const monto = parseFloat(document.getElementById('fiado-pago-monto').value) || 0;
  const metodo = document.getElementById('fiado-pago-metodo')?.value || 'Efectivo';
  if (monto <= 0) { alert('Monto inválido.'); return; }
  const sede = sedeAdminEfectiva();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()

  // CRITICO: runTransaction en vez de writeBatch — un batch es atomico DENTRO de una sola
  // llamada (todo o nada), pero no protege contra que 2 pagos casi simultaneos sobre el MISMO
  // fiado (2 cajeros, o el mismo cajero cobrando rapido) lean el mismo estado viejo y se pisen
  // el uno al otro. La transaccion lee el fiado real del servidor en el momento exacto de
  // escribir — si el saldo real ya no alcanza porque otro pago se coló entre medio, esta
  // llamada se rechaza con un aviso claro en vez de perder ese pago anterior en silencio.
  // Firestore reintenta sola la transaccion perdedora si hay conflicto (mismo mecanismo ya
  // probado en ensureCajaAbierta() y en el correlativo de comprobantes).
  const fiadoRef = docM(dbModular, 'fiados', String(f.id));
  let _r;
  try {
    _r = await runTransactionM(dbModular, async (tx) => {
      const snap = await tx.get(fiadoRef); // lectura garantizada real del servidor, nunca cache
      if (!snap.exists()) throw new Error('Este fiado ya no existe — puede que ya se haya eliminado.');
      const fServidor = snap.data(); // en modular, exists es un METODO
      const pendienteReal = Math.max(0, Math.round(((fServidor.total||0) - (fServidor.pagado||0)) * 100) / 100);
      if (monto > pendienteReal) {
        throw new Error('El monto (' + sol(monto) + ') supera el saldo real pendiente (' + sol(pendienteReal) + '). Alguien más pudo haber registrado un pago recién — revisa el fiado actualizado antes de reintentar.');
      }
      const costoAsociado = _asignarPagoAItems(fServidor, monto);
      const _fPagoEntry = { fecha: today(), hora: nowTime(), cajero: currentUser, monto, metodo };
      const _fPagado = Math.round(((fServidor.pagado||0) + monto) * 100) / 100;
      const _fEstado = (Math.round(((fServidor.total||0) - _fPagado) * 100) / 100) <= 0 ? 'pagado' : 'pendiente';

      tx.set(fiadoRef, { ...fServidor, pagado: _fPagado, pagos: [...(fServidor.pagos||[]), _fPagoEntry], sedeId: fServidor.sedeId || sede, estado: _fEstado });
      tx.set(docM(dbModular, 'clientes', String(fServidor.clienteId)), { deuda: incrementM(-monto) }, { merge: true });

      const _movId = getId();
      const _movData = { id:_movId, tipo:'ingreso', desc:`Pago fiado (${metodo}): ` + getClienteNombre(fServidor.clienteId), monto, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
      tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

      const _cajaUpdate = { ingresos: incrementM(monto) };
      if (metodo === 'Efectivo') _cajaUpdate.ingresosEfectivo = incrementM(monto);
      tx.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });

      const _pagoFiado = { id: getId(), fecha: today(), hora: nowTime(), origen: 'pago_fiado', estado: 'completado', clienteId: fServidor.clienteId, fiadoId: fServidor.id, total: monto, metodo, cajero: currentUser, costoAsociado, sedeId: sede };
      tx.set(docM(dbModular, 'ventas', String(_pagoFiado.id)), _pagoFiado);

      return { _fPagoEntry, _fPagado, _fEstado, _movData, _pagoFiado };
    });
  } catch (e) {
    alert('⚠️ No se pudo registrar el pago: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se refleja en memoria local.
  if (!f.pagos) f.pagos = [];
  f.pagos.push(_r._fPagoEntry);
  f.pagado = _r._fPagado;
  f.estado = _r._fEstado;
  const cli = DB.clientes.find(c => c.id === f.clienteId);
  if (cli) {
    _clienteProxySkipSync = true;
    try { _aplicarDeudaLocal(cli, -monto); }
    finally { _clienteProxySkipSync = false; }
  }
  // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
  DB.caja.ingresos += monto;
  if (metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + monto;

  if (!DB.historialVentas) DB.historialVentas = [];
  DB.historialVentas.push(_r._pagoFiado);
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_r._movData);
  fbGuardar();
  cerrarModal('modal-pago-fiado');
  renderFiados();
  updateAlertCount();
  try { renderDashboard(); } catch(e){}
  try { renderCaja(); } catch(e){}
  try { generarReporte(); } catch(e){}
}

function compartirFiadoWhatsapp() {
  const f = DB.fiados.find(x => x.id === editingFiadoId);
  if (!f) return;
  const pendiente = fiadoMontoPendiente(f);
  if (pendiente <= 0) { alert('Este fiado ya está pagado — no hay deuda que recordar.'); return; }
  const cli = DB.clientes.find(c => c.id === f.clienteId);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const tel = cli && cli.tel ? cli.tel.replace(/\s/g,'') : '';
  const itemsPend = f.items.map(i => `• ${i.nombre} x${i.cant} = ${sol(subtotalItemCarrito(i))}`).join('\n');
  const msg = `Hola ${nombre}, le recordamos su deuda en *${DB.config.nombre||'Tienda Aleze'}*:\n\n${itemsPend}\n\n*Total pendiente: ${sol(pendiente)}*\n\nGracias 🙏`;
  const url = _waUrl(tel, msg);
  window.open(url, '_blank');
}

let historialClienteId = null;

async function abrirHistorialCliente(cid, e) {
  if (e) e.stopPropagation();
  historialClienteId = cid;
  const cli = DB.clientes.find(c => c.id === cid);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Anónimo';

  abrirModal('modal-historial-cliente');
  document.getElementById('hcli-titulo').textContent = '📋 Historial — ' + nombre;
  document.getElementById('hcli-resumen').innerHTML = '⏳ Trayendo historial completo...';
  document.getElementById('hcli-filtro-tipo').value = 'todo';
  document.getElementById('hcli-desde').value = '';
  document.getElementById('hcli-hasta').value = '';

  // "Historial completo" de verdad: la vista local puede tener recortado lo ya pagado más
  // viejo de 90 días (poda de escalabilidad) — acá se consulta fiados/{id} directo por este
  // cliente puntual, trayendo lo que falte sin tener que cargar la colección entera cada vez.
  if (dbModular) { // [SDK modular]
    try {
      const snap = await getDocsM(queryM(collectionM(dbModular, 'fiados'), whereM('clienteId', '==', cid)));
      const idsLocales = new Set(DB.fiados.map(f => f.id));
      snap.forEach(doc => {
        const id = parseInt(doc.id);
        if (!idsLocales.has(id)) DB.fiados.push({ id, ...doc.data() });
      });
    } catch(e) { console.warn('abrirHistorialCliente: no se pudo traer historial completo, mostrando lo local', e); }
  }

  const fiados = DB.fiados.filter(f => f.clienteId === cid);
  const totalCli = fiados.reduce((s, f) => s + f.total, 0);
  const pagadoCli = fiados.reduce((s, f) => s + f.pagado, 0);
  const pendienteCli = totalCli - pagadoCli;
  document.getElementById('hcli-resumen').innerHTML = `
    <span>🛒 <strong>${fiados.length}</strong> venta(s)</span>
    <span>💰 Total acumulado: <strong>${sol(totalCli)}</strong></span>
    <span style="color:var(--accent)">✅ Pagado: <strong>${sol(pagadoCli)}</strong></span>
<span style="color:${pendienteCli>0?'var(--danger)':'var(--accent)'}">${pendienteCli>0?'⏳ Pendiente':'✅ Sin deuda'}: <strong>${sol(pendienteCli)}</strong></span>`;
  renderHistorialCliente();
}

function renderHistorialCliente() {
  const cid = historialClienteId;
  const tipo = document.getElementById('hcli-filtro-tipo').value;
  const desde = document.getElementById('hcli-desde').value;
  const hasta = document.getElementById('hcli-hasta').value;
  let fiados = DB.fiados.filter(f => f.clienteId === cid);

  // Filtro por rango de fechas
  if (desde) fiados = fiados.filter(f => f.fecha >= desde);
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta);

  // Filtro por tipo
  if (tipo === 'pendientes') fiados = fiados.filter(f => fiadoPendiente(f));
  else if (tipo === 'pagados') fiados = fiados.filter(f => !fiadoPendiente(f));

  const contenido = document.getElementById('hcli-contenido');

  if (tipo === 'pagos') {
    // Mostrar solo los registros de pagos realizados
    let pagos = [];
    DB.fiados.filter(f => f.clienteId === cid).forEach(f => {
      (f.pagos || []).forEach(p => {
        if ((!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta)) {
          pagos.push({ ...p, fiadoId: f.id, items: f.items });
        }
      });
    });
    pagos.sort((a, b) => (a.fecha + a.hora) > (b.fecha + b.hora) ? -1 : 1);
    const totalPagos = pagos.reduce((s, p) => s + p.monto, 0);
    document.getElementById('hcli-resumen-filtro').textContent = `${pagos.length} pago(s) encontrado(s) · Total: ${sol(totalPagos)}`;
    contenido.innerHTML = pagos.length === 0
      ? '<p style="color:var(--gray-400);text-align:center;padding:1rem">Sin pagos en este período</p>'
      : pagos.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;background:var(--accent-light);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;margin-bottom:.4rem">
          <div>
            <div style="font-size:.82rem;font-weight:600;color:var(--accent-dark)">💳 Abono registrado</div>
            <div style="font-size:.72rem;color:var(--gray-500)">${p.fecha} ${p.hora} — por <em>${p.cajero}</em></div>
            <div style="font-size:.72rem;color:var(--gray-500)">${p.items.map(i=>escapeHtml(i.nombre)).join(', ')}</div>
          </div>
          <strong style="color:var(--accent);font-size:.95rem">+${sol(p.monto)}</strong>
        </div>`).join('');
    return;
  }

  const totalPend = fiados.reduce((s, f) => s + fiadoMontoPendiente(f), 0);
  document.getElementById('hcli-resumen-filtro').textContent = `${fiados.length} venta(s) encontrada(s) · Pendiente: ${sol(totalPend)}`;
  contenido.innerHTML = fiados.length === 0
    ? '<p style="color:var(--gray-400);text-align:center;padding:1rem">Sin registros para los filtros seleccionados</p>'
    : [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
        const pend = fiadoMontoPendiente(f);
        const pagosF = (f.pagos || []);
        return `<div style="border-left:3px solid ${pend>0?'var(--warning)':'var(--accent)'};padding:.6rem .75rem;margin-bottom:.6rem;background:white;border-radius:0 6px 6px 0;box-shadow:var(--shadow)">
          <div style="display:flex;justify-content:space-between;margin-bottom:.3rem">
            <span style="font-size:.75rem;color:var(--gray-500)">📅 ${formatDate(f.fecha)} ${f.hora||''}</span>
            <span style="font-weight:700;font-size:.85rem;color:${pend>0?'var(--danger)':'var(--accent)'}">
              ${pend > 0 ? sol(pend)+' pendiente' : '✅ Saldado'}
            </span>
          </div>
          <div style="font-size:.8rem;margin-bottom:.3rem">${f.items.map(i=>`${escapeHtml(i.nombre)} x${i.cant} = ${sol(subtotalItemCarrito(i))}`).join(' · ')}</div>
          <div style="font-size:.72rem;color:var(--gray-500);margin-bottom:.3rem">Total: ${sol(f.total)} | Pagado: ${sol(f.pagado)}</div>
          ${pagosF.length > 0 ? `<div style="font-size:.72rem;color:var(--gray-600);border-top:1px dashed var(--gray-200);padding-top:.3rem;margin-top:.3rem">
            ${pagosF.map(p=>`<span style="margin-right:.75rem">💳 ${p.fecha} ${p.hora} <em>${p.cajero}</em>: +${sol(p.monto)}</span>`).join('')}
          </div>` : ''}
          ${pend > 0 ? `<button class="btn btn-accent btn-xs" style="margin-top:.4rem" onclick="cerrarModal('modal-historial-cliente');abrirPagoFiado(${f.id})">💰 Registrar pago</button>` : ''}
        </div>`;
      }).join('');
}

function limpiarFiltrosHistorial() {
  document.getElementById('hcli-filtro-tipo').value = 'todo';
  document.getElementById('hcli-desde').value = '';
  document.getElementById('hcli-hasta').value = '';
  renderHistorialCliente();
}

function compartirHistorialWhatsapp() {
  const cid = historialClienteId;
  const cli = DB.clientes.find(c => c.id === cid);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const tel = cli && cli.tel ? cli.tel.replace(/\s/g,'') : '';
  const tipo = document.getElementById('hcli-filtro-tipo').value;
  const desde = document.getElementById('hcli-desde').value;
  const hasta = document.getElementById('hcli-hasta').value;
  let fiados = DB.fiados.filter(f => f.clienteId === cid);
  if (desde) fiados = fiados.filter(f => f.fecha >= desde);
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta);

  let msg = `Hola ${nombre}, aquí su resumen en *${DB.config.nombre||'Tienda Aleze'}*:\n`;
  if (desde || hasta) msg += `📅 Período: ${desde ? formatDate(desde) : 'inicio'} al ${hasta ? formatDate(hasta) : 'hoy'}\n`;
  msg += '\n';

  if (tipo === 'pagos') {
    let pagos = [];
    DB.fiados.filter(f => f.clienteId === cid).forEach(f => {
      (f.pagos || []).forEach(p => {
        if ((!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta)) pagos.push(p);
      });
    });
    const total = pagos.reduce((s, p) => s + p.monto, 0);
    msg += `*Pagos realizados:*\n`;
    pagos.forEach(p => { msg += `• ${p.fecha} ${p.hora} — ${sol(p.monto)} (${p.cajero})\n`; });
    msg += `\n*Total abonado: ${sol(total)}*\n`;
  } else {
    if (tipo === 'pendientes') fiados = fiados.filter(f => fiadoPendiente(f));
    else if (tipo === 'pagados') fiados = fiados.filter(f => !fiadoPendiente(f));
    const totalPend = Math.round(fiados.reduce((s, f) => s + fiadoMontoPendiente(f), 0) * 100) / 100;
    fiados.forEach(f => {
      const pend = fiadoMontoPendiente(f);
      msg += `📌 ${formatDate(f.fecha)}: ${f.items.map(i=>`${i.nombre} x${i.cant}`).join(', ')} → ${sol(f.total)}`;
      msg += pend > 0 ? ` _(pendiente: ${sol(pend)})_\n` : ` ✅\n`;
    });
    if (tipo !== 'pagados') msg += `\n*Total pendiente: ${sol(totalPend)}*\n`;
  }
  msg += '\nGracias 🙏';
  const url = _waUrl(tel, msg);
  window.open(url, '_blank');
}

// ===================== WHATSAPP IMAGEN =====================
async function compartirWhatsapp() {
  const ticket = document.getElementById('ticket-print');
  if (!ticket) { alert('Sin ticket disponible'); return; }
  // CRITICO: el ticket vive dentro de .modal, que tiene max-height:90dvh + overflow-y:auto —
  // con muchos productos, el ticket crece mas alto que el modal visible y queda scrolleable.
  // html2canvas puede capturar mal un elemento asi (solo lo que esta scrolleado a la vista, o
  // con un alto mal calculado) — por eso "no cuadraba" con tickets largos. La solucion es
  // clonar el ticket a un contenedor invisible, FUERA del modal, sin altura fija ni scroll, y
  // capturar ESE clon — asi el resultado siempre incluye el ticket completo, sin importar
  // cuantos productos tenga ni cuanto se haya scrolleado el modal en pantalla.
  const clon = ticket.cloneNode(true);
  clon.id = 'ticket-print-clon';
  clon.style.position = 'fixed';
  clon.style.left = '-9999px';
  clon.style.top = '0';
  clon.style.maxHeight = 'none';
  clon.style.overflow = 'visible';
  document.body.appendChild(clon);
  try {
    if (!window.html2canvas) { await new Promise(res => _loadHtml2Canvas(res)); }
    const canvas = await html2canvas(clon, { scale: 2, backgroundColor: '#ffffff' });
    canvas.toBlob(blob => {
      const file = new File([blob], 'ticket-aleze.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: 'Ticket ' + (DB.config.nombre||'Tienda Aleze'), files: [file] })
          .catch(() => fallbackWA());
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'ticket-aleze.png'; a.click();
        setTimeout(() => window.open(_waUrl(null, ''), '_blank'), 600);
        alert('Imagen descargada. Compártela por WhatsApp.');
      }
    }, 'image/png');
  } catch(e) { fallbackWA(); }
  finally { clon.remove(); }
}

function fallbackWA() {
  const t = document.getElementById('ticket-print');
  window.open(_waUrl(null, t ? t.innerText : ''), '_blank');
}

// ===================== FRECUENTES =====================
// ── Fidelización: configuración de puntos, tasa de canje y multiplicadores por categoría ──
function renderFidelizacionConfig() {
  document.getElementById('fid-tasa-base').value = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaBase) || 1;
  document.getElementById('fid-tasa-canje').value = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaCanje) || 300;
  renderMultiplicadoresCategorias();
  renderCanjesHistorial();
}

function guardarFidelizacionConfig() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede cambiar las reglas del programa de puntos.'); return; }
  const tasaBase = parseFloat(document.getElementById('fid-tasa-base').value) || 1;
  const tasaCanje = parseFloat(document.getElementById('fid-tasa-canje').value) || 300;
  DB_EXT.fidelizacion = { tasaBase, tasaCanje };
  fbGuardarExt();
  alert('✅ Configuración guardada.');
}

function renderMultiplicadoresCategorias() {
  const el = document.getElementById('fid-multiplicadores-list');
  el.innerHTML = DB.categorias.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.3rem 0;border-bottom:1px solid var(--gray-100)">
      <span>${c.emoji||''} ${c.nombre}</span>
      <input type="number" class="form-control" style="width:70px" value="${c.multiplicadorPuntos||1}" step="0.5" min="0"
        onchange="cambiarMultiplicadorCategoria(${c.id}, this.value)" />
    </div>`).join('');
}

function cambiarMultiplicadorCategoria(catId, valor) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede cambiar el multiplicador de puntos por categoría.'); return; }
  const cat = DB.categorias.find(c => c.id === catId);
  if (!cat) return;
  cat.multiplicadorPuntos = parseFloat(valor) || 1;
  fbGuardarProductos();
}

function renderCanjesHistorial() {
  const el = document.getElementById('fid-canjes-historial');
  if (!el) return;
  if (!dbModular) { el.innerHTML = ''; return; } // [SDK modular]
  el.innerHTML = '⏳ Cargando...';
  getDocsM(queryM(collectionM(dbModular, 'canjes'), orderByM('fecha', 'desc'), limitM(20))).then(snap => {
    if (snap.empty) { el.innerHTML = '<div style="color:var(--gray-400);padding:.5rem">Sin canjes todavía.</div>'; return; }
    el.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `<div style="padding:.35rem 0;border-bottom:1px solid var(--gray-100);font-size:.85rem">
        📅 ${formatDate(c.fecha)} — <strong>${getClienteNombre(c.clienteId)}</strong> canjeó <strong>${c.puntosUsados} pts</strong> por ${sol(c.montoDescuento||0)} de descuento
      </div>`;
    }).join('');
  }).catch(() => { el.innerHTML = 'Error cargando canjes.'; });
}

function renderFrecuentes() {
  renderFidelizacionConfig();
  const crowns = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  // Ranking completo
  const todos = [...DB.clientes].sort((a, b) => b.total - a.total);
  document.getElementById('ranking-table').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Cliente</th><th>Alias</th><th>Consumo año</th><th>Puntos</th><th>Canjeable</th></tr></thead>
      <tbody>${todos.map((c, i) => {
        const est = estadoFidelizacion(c.id);
        const pct = Math.min(100, (c.total || 0) / 300 * 100);
        return `<tr>
          <td>${crowns[i] || i+1}</td>
          <td><strong>${c.nombre || 'Cliente sin nombre'}</strong></td>
          <td><span class="badge badge-blue">${c.alias||'-'}</span></td>
          <td>
            <strong>${sol(c.total)}</strong>
            <div class="progress-bar" style="margin-top:.3rem"><div class="progress-fill" style="background:var(--primary);width:${pct}%"></div></div>
          </td>
          <td><span class="badge badge-gold">⭐ ${est.saldo} pts</span></td>
          <td>${est.valorCanjeable > 0 ? `<span style="color:var(--accent);font-weight:700">🎁 ${sol(est.valorCanjeable)}</span>` : '-'}</td>
          <td><button class="btn btn-outline btn-xs" onclick="verHistorialCliente(${c.id})">📋</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// Premio sugerido al vender

