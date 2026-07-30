// ===================== CLIENTES =====================
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
  const _sedeCli = sedeAdminEfectiva();
  document.getElementById('cli-tbody').innerHTML = lista.map(c => { const _deudaSede = deudaClienteEnSede(c, _sedeCli); return `<tr>
    <td><strong>${c.nombre || 'Cliente sin nombre'}</strong></td>
    <td><span class="badge badge-blue">${c.alias||'-'}</span></td>
    <td>${c.tel||'-'}</td>
    <td>${c.cumple ? formatDate(c.cumple) : '-'}</td>
   <td>${getNivel(c.total||0) ? `<span class="badge badge-gold">⭐ ${getNivel(c.total||0).desc}</span>` : '<span class="badge badge-gray">Regular</span>'}</td>
    <td><strong>${sol(c.total||0)}</strong></td>
    <td style="color:${_deudaSede>0?'var(--danger)':'var(--accent)'}"><strong>${_deudaSede > 0 ? sol(_deudaSede) : '✅ Al día'}</strong></td>
    <td style="white-space:nowrap">
      <button class="btn btn-outline btn-xs" onclick="verHistorialCliente(${c.id})">📋</button>
      <button class="btn btn-outline btn-xs" onclick="editarCliente(${c.id})">✏️ Editar</button>
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
  const data = { nombre, alias: document.getElementById('cli-alias').value.trim(), tel: document.getElementById('cli-tel').value, dir: document.getElementById('cli-dir').value, cumple: document.getElementById('cli-cumple').value };
  if (editingCliId) {
    const c = DB.clientes.find(x => x.id === editingCliId);
    Object.assign(c, data);
  } else {
    DB.clientes.push(_envolverCliente({ id: getId(), ...data, compras: 0, total: 0, deudaPorSede: { principal: 0, 'Tienda Aleze II': 0 } }));
  }
  fbGuardar();
  cerrarModal('modal-cliente');
  renderClientes();
  updatePosClientes();
  updateAlertCount();
}

function eliminarCliente(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar clientes.'); return; }
  const c = DB.clientes.find(x => x.id === id);
  // Unica excepcion valida a "nunca sumar sedes" — eliminar el cliente lo borra por completo,
  // asi que hay que confirmar que no tenga deuda pendiente en NINGUNA de las 2.
  const _deudaTotal = deudaClienteTotal(c);
  if (c && _deudaTotal > 0) { alert('Este cliente tiene deuda pendiente de S/ ' + sol(_deudaTotal) + ' (entre ambas sedes). Salda los fiados antes de eliminarlo.'); return; }
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
    if (estado === 'pendiente') fiadosParaSelector = fiadosParaSelector.filter(f => (f.total - f.pagado) > 0.01);
    if (estado === 'pagado')    fiadosParaSelector = fiadosParaSelector.filter(f => (f.total - f.pagado) <= 0.01);
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
  if (estado === 'pendiente') clienteIds = clienteIds.filter(cid => porCliente[cid].some(f => (f.total - f.pagado) > 0));
  if (estado === 'pagado') clienteIds = clienteIds.filter(cid => porCliente[cid].every(f => (f.total - f.pagado) <= 0));

  // Filtro por fecha — aplica sobre fiados individuales
  if (desde || hasta) {
    clienteIds = clienteIds.filter(cid => porCliente[cid].some(f =>
      (!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta)
    ));
  }

  const totalDeuda = _fiadosSede.reduce((s, f) => s + Math.max(0, f.total - f.pagado), 0);
  const clientesConDeuda = [...new Set(_fiadosSede.map(f => f.clienteId))].filter(cid =>
    _fiadosSede.filter(f => f.clienteId === cid).some(f => (f.total - f.pagado) > 0)
  ).length;
  const mayor = [...new Set(_fiadosSede.map(f => f.clienteId))].reduce((m, cid) => {
    const d = _fiadosSede.filter(f => f.clienteId === cid).reduce((s, f) => s + Math.max(0, f.total - f.pagado), 0);
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
    if (desde || hasta) fiados = fiados.filter(f => ((!desde || f.fecha >= desde) && (!hasta || f.fecha <= hasta)) || (f.total - f.pagado) > 0.01);
    else fiados = fiados.filter(f => f.fecha >= _hace30diasStr || (f.total - f.pagado) > 0.01);
    const totalCli = Math.round(fiados.reduce((s, f) => s + f.total, 0) * 100) / 100;
    const pagadoCli = Math.round(fiados.reduce((s, f) => s + f.pagado, 0) * 100) / 100;
    const pendienteCli = Math.round((totalCli - pagadoCli) * 100) / 100;
    const detalleId = 'fiado-detalle-' + cid;
    const detalle = [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
      const pend = Math.round((f.total - f.pagado) * 100) / 100;
      return `<div style="border-left:3px solid var(--warning);padding:.5rem .75rem;margin-bottom:.5rem;background:white;border-radius:0 6px 6px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
          <span style="font-size:.75rem;color:var(--gray-500)">${formatDate(f.fecha)}</span>
          <span style="font-size:.82rem;font-weight:700;color:${pend>0?'var(--danger)':'var(--accent)'}">
            ${pend > 0 ? sol(pend)+' pendiente' : '✅ Pagado'}
          </span>
        </div>
        <div style="font-size:.8rem;margin-bottom:.3rem">
          ${f.items.map(i => `${i.nombre} x${i.cant} = ${sol(i.precio*i.cant)}`).join(' · ')}
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
          <strong style="font-size:1rem">${nombre}</strong>
          ${tel ? `<span style="font-size:.72rem;color:var(--gray-400);margin-left:.5rem">📞 ${tel}</span>` : ''}
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
  if (desde) fiados = fiados.filter(f => f.fecha >= desde || (f.total - f.pagado) > 0.01);
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta || (f.total - f.pagado) > 0.01);
  if (tipo === 'pendiente') fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) > 0);
  if (tipo === 'pagado')    fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) <= 0);
  const html = [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
    const pend = Math.round((f.total - f.pagado) * 100) / 100;
    return `<div style="border-left:3px solid var(--warning);padding:.5rem .75rem;margin-bottom:.5rem;background:white;border-radius:0 6px 6px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
        <span style="font-size:.75rem;color:var(--gray-500)">${formatDate(f.fecha)}</span>
        <span style="font-size:.82rem;font-weight:700;color:${pend>0?'var(--danger)':'var(--accent)'}">
          ${pend > 0 ? sol(pend)+' pendiente' : '✅ Pagado'}
        </span>
      </div>
      <div style="font-size:.8rem;margin-bottom:.3rem">
        ${f.items.map(i => `${i.nombre} x${i.cant} = ${sol(i.precio*i.cant)}`).join(' · ')}
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
  if (desde) fiados = fiados.filter(f => f.fecha >= desde || (f.total - f.pagado) > 0.01);
  if (hasta) fiados = fiados.filter(f => f.fecha <= hasta || (f.total - f.pagado) > 0.01);
  if (tipo === 'pendiente') fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) > 0);
  if (tipo === 'pagado')    fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) <= 0);
  const totalPend = Math.round(fiados.reduce((s, f) => s + Math.max(0, f.total - f.pagado), 0) * 100) / 100;
  let msg = `Hola ${nombre}, su resumen de fiados en *${DB.config.nombre||'Tienda Aleze'}*:\n`;
  if (desde || hasta) msg += `📅 Período: ${desde ? formatDate(desde) : 'inicio'} al ${hasta ? formatDate(hasta) : 'hoy'}\n`;
  msg += '\n';
  fiados.forEach(f => {
    const pend = Math.round((f.total - f.pagado) * 100) / 100;
    msg += `📌 ${formatDate(f.fecha)}: ${f.items.map(i => i.nombre + ' x' + i.cant).join(', ')} → ${sol(f.total)}`;
    msg += pend > 0 ? ` _(pendiente: ${sol(pend)})_\n` : ` ✅\n`;
  });
  msg += `\n*Total pendiente: ${sol(totalPend)}*\nGracias 🙏`;
  const url = tel ? `https://wa.me/51${tel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function abrirPagoGlobal(cid) {
  const cli = DB.clientes.find(c => c.id === cid);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const _sedeAPG = sedeAdminEfectiva();
 const pendienteTotal = Math.round(DB.fiados.filter(f => f.clienteId === cid && (f.sedeId||'principal') === _sedeAPG).reduce((s,f) => s + Math.max(0, f.total - f.pagado), 0) * 100) / 100;
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
  const itemsOrdenados = [...(fiado.items||[])].sort((a,b) => (a.precio*a.cant) - (b.precio*b.cant));
  let saldoItem = monto;
  let costo = 0;
  itemsOrdenados.forEach(i => {
    if (saldoItem <= 0) return;
    const totalItem = i.precio * i.cant;
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
  let saldo = montoTotal;
  const _sedeEPG = sedeAdminEfectiva();
  const fiados = DB.fiados.filter(f => f.clienteId === cid && (f.sedeId||'principal') === _sedeEPG && (f.total - f.pagado) > 0).sort((a,b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id);

  // Mismo criterio que la venta: TODOS los fiados tocados, el cliente, caja, movimiento y
  // cada registro de historial viajan en un solo lote — o se aplican todos juntos, o ninguno.
  // Esta es la funcion que coincide exactamente con el incidente real reportado (pago global
  // parcial perdido) — antes cada fiado se sincronizaba por separado, sin ninguna garantia.
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  const batch = writeBatchM(dbModular);
  const _cambiosLocales = []; // {f, montoPagadoEsteFiado, pagoEntry} para aplicar tras el exito
  const _hvPagosGlobal = [];

  fiados.forEach(f => {
    if (saldo <= 0) return;
    const pendFiado = Math.round((f.total - f.pagado) * 100) / 100;
    const montoPagadoEsteFiado = Math.min(saldo, pendFiado);
    if (montoPagadoEsteFiado > 0) {
      // Nota: _asignarPagoAItems SI modifica f.items[].pagado como parte de calcular el costo
      // asociado — es la unica pieza que se adelanta a la confirmacion del lote (necesaria
      // para el calculo), a diferencia de todo lo demas en esta funcion que espera el exito.
      // Riesgo minimo: si el lote fallara despues de esto, esta marca queda en memoria local
      // nada mas, se corrige sola al recargar (trae el fiado real de Firestore de nuevo).
      const costoAsociado = _asignarPagoAItems(f, montoPagadoEsteFiado);
      const _fPagoEntry = { fecha: today(), hora: nowTime(), cajero: currentUser, monto: montoPagadoEsteFiado, tipo: 'global' };
      const _fPagado = Math.round((f.pagado + montoPagadoEsteFiado) * 100) / 100;
      batch.set(docM(dbModular, 'fiados', String(f.id)), { ...f, pagado: _fPagado, pagos: [...(f.pagos||[]), _fPagoEntry] });
      saldo = Math.round((saldo - montoPagadoEsteFiado) * 100) / 100;
      const _entry = { id: getId(), fecha: today(), hora: nowTime(), origen: 'pago_fiado', estado: 'completado', clienteId: cid, fiadoId: f.id, total: montoPagadoEsteFiado, metodo, cajero: currentUser, costoAsociado, sedeId: _sedeEPG };
      batch.set(docM(dbModular, 'ventas', String(_entry.id)), _entry);
      _hvPagosGlobal.push(_entry);
      _cambiosLocales.push({ f, montoPagadoEsteFiado, _fPagoEntry, _fPagado });
    }
  });

  batch.set(docM(dbModular, 'clientes', String(cid)), {
    deudaPorSede: { [_sedeEPG]: incrementM(-montoTotal) }
  }, { merge: true });

  const _movId = getId();
  const _movData = { id:_movId, tipo:'ingreso', desc:`Pago global fiado (${metodo}): ` + getClienteNombre(cid), monto: montoTotal, hora: nowTime(), fecha: today(), sedeId: _sedeEPG };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  const _cajaUpdate = { ingresos: incrementM(montoTotal) };
  if (metodo === 'Efectivo') _cajaUpdate.ingresosEfectivo = incrementM(montoTotal);
  batch.set(docM(dbModular, 'caja', _sedeEPG), _cajaUpdate, { merge: true });

  const _idPagoGlobal = 'pago_global_' + cid + '_' + Date.now();
  _sincIniciar('pago_global_lote', _idPagoGlobal);
  try {
    await batch.commit();
    _sincTerminar('pago_global_lote', _idPagoGlobal);
  } catch (e) {
    _sincError('pago_global_lote', _idPagoGlobal, e, 'el pago global — no se aplicó nada, ningún fiado quedó marcado como pagado');
    return;
  }

  // El lote ya fue aceptado — recien ahora se aplican los cambios en memoria local.
  _cambiosLocales.forEach(({f, _fPagoEntry, _fPagado}) => {
    if (!f.pagos) f.pagos = [];
    f.pagos.push(_fPagoEntry);
    f.pagado = _fPagado;
  });
  const cli = DB.clientes.find(c => c.id === cid);
  if (cli) {
    _clienteProxySkipSync = true;
    try { _aplicarDeudaLocal(cli, _sedeEPG, -montoTotal); }
    finally { _clienteProxySkipSync = false; }
  }
  // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
  DB.caja.ingresos += montoTotal;
  if (metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + montoTotal;
  
  if (!DB.historialVentas) DB.historialVentas = [];
  _hvPagosGlobal.forEach(entry => DB.historialVentas.push(entry));
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  fbGuardar();
  renderFiados();
  updateAlertCount();
  try { renderDashboard(); } catch(e) {}
  try { renderCaja(); } catch(e) {}
  alert('✅ Pago global de ' + sol(montoTotal) + ' registrado correctamente.');
}

function confirmarEliminarFiado(id) {
  const f = DB.fiados.find(x => x.id === id);
  if (!f) return;
  // CRITICO — cierra un hueco real: la lista de Fiados ya filtra por sede, pero eliminar/cobrar
  // no volvia a verificarlo, dejando la puerta abierta a tocar un fiado de la otra sede si se
  // llegaba a el por otro camino (ej. historial de un cliente). Defensa en profundidad — nunca
  // se permite tocar un fiado que no sea de la sede activa, sin importar como se llego hasta el.
  if (currentRole !== 'admin' && (f.sedeId||'principal') !== sedeAdminEfectiva()) {
    alert('⛔ Este fiado pertenece a la otra sede — no se puede modificar desde acá.');
    return;
  }
  const pend = f.total - f.pagado;
  const opciones = pend > 0
    ? `¿Cómo deseas eliminar este fiado de ${sol(f.total)}?

1. ERROR DE REGISTRO → restaura stock
2. PÉRDIDA/INCOBRABLE → registra en mermas

Escribe 1 o 2:`
    : `¿Eliminar este fiado ya pagado?

Escribe 1 para confirmar:`;
  const resp = prompt(opciones);
  if (!resp) return;

  if (resp.trim() === '1') {
    // Restaurar stock en la sede donde se hizo la venta original
    f.items.forEach(i => {
      const prod = DB.productos.find(p => p.id === i.prodId);
      if (prod) ajustarStockSede(prod, i.cant, f.sedeId);
    });
    DB.fiados = DB.fiados.filter(x => x.id !== id);
    if (dbModular) deleteDocM(docM(dbModular, 'fiados', String(id))).catch(e => console.warn('No se pudo borrar fiados/'+id, e)); // [SDK modular]
    const cli = DB.clientes.find(c => c.id === f.clienteId);
    
    // === AQUÍ SE APLICA EL CAMBIO PARA LA OPCIÓN 1 ===
    if (cli) ajustarDeudaCliente(cli, f.sedeId||'principal', -pend);
    
    fbGuardar(); fbGuardarProductos();
    renderFiados(); renderInventario && renderInventario();
    alert('✅ Fiado eliminado y stock restaurado.');

  } else if (resp.trim() === '2' && pend > 0) {
    // Registrar como merma
    let _algunaMermaRegistrada = false;
    const propPend = pend / f.total;
    f.items.forEach(i => {
      const prod = DB.productos.find(p => p.id === i.prodId);
      if (!prod) return;
      const cantMermaExacta = i.cant * propPend;
      const cantMerma = Math.round(cantMermaExacta * 100) / 100;
      const perdidaMonto = Math.round(prod.costo * cantMermaExacta * 100) / 100;
      if (perdidaMonto <= 0) return;
    const _mermaFI = { id: getId(), prodId: i.prodId, cant: cantMerma, motivo: 'Fiado incobrable', obs: 'Fiado #' + f.id + ' — ' + getClienteNombre(f.clienteId), fecha: today(), usuario: currentUser, sedeId: f.sedeId || 'principal' };
    DB.mermas.push(_mermaFI);
      fbSincronizarMerma(_mermaFI);
      _algunaMermaRegistrada = true;
    });

   if (!_algunaMermaRegistrada && pend > 0) {
      const _mermaFISinDetalle = { id: getId(), prodId: null, cant: 0, motivo: 'Fiado incobrable', obs: 'Fiado #' + f.id + ' (saldo, sin detalle por producto) — ' + getClienteNombre(f.clienteId) + ' — Pérdida: ' + sol(pend), fecha: today(), usuario: currentUser, sedeId: f.sedeId || 'principal' };
      DB.mermas.push(_mermaFISinDetalle);
      fbSincronizarMerma(_mermaFISinDetalle);
    }
    DB.fiados = DB.fiados.filter(x => x.id !== id);
    if (dbModular) deleteDocM(docM(dbModular, 'fiados', String(id))).catch(e => console.warn('No se pudo borrar fiados/'+id, e)); // [SDK modular]
    const cli = DB.clientes.find(c => c.id === f.clienteId);
    
    // === AQUÍ SE APLICA EL CAMBIO PARA LA OPCIÓN 2 ===
    if (cli) ajustarDeudaCliente(cli, f.sedeId||'principal', -pend);
    
    fbGuardar(); fbGuardarProductos();
    renderFiados(); try { renderMermas(); } catch(e) {}
    alert('✅ Fiado eliminado y registrado como merma.');
  } else {
    alert('Opción no válida. No se realizó ningún cambio.');
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
  const pendiente = f.total - f.pagado;
  document.getElementById('fiado-detalle').innerHTML = `
    <div style="background:var(--gray-50);border-radius:8px;padding:0.75rem;margin-bottom:1rem">
      <strong>${getClienteNombre(f.clienteId)}</strong>
      ${cli && cli.tel ? `<span style="font-size:.78rem;color:var(--gray-500);margin-left:.5rem">📞 ${cli.tel}</span>` : ''}
      <div style="font-size:0.82rem;margin-top:.4rem">
        ${f.items.map(i => `${i.nombre} x${i.cant} = ${sol(i.precio*i.cant)}`).join(' · ')}
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
const pendiente = Math.round((f.total - f.pagado) * 100) / 100;
  if (monto <= 0 || monto > pendiente) { alert('Monto inválido. Máximo: ' + sol(pendiente)); return; }
  const costoAsociado = _asignarPagoAItems(f, monto);

  // Mismo criterio que la venta: el pago es un paquete — fiado actualizado, deuda del
  // cliente, movimiento, caja y el registro en historial viajan juntos o no viaja nada.
  // Antes de este cambio, este pago tenia el mismo hueco que la venta/fiado original: cada
  // pieza viajaba por separado, sin ninguna garantia de que llegaran todas juntas.
  const sede = sedeAdminEfectiva();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  const batch = writeBatchM(dbModular);

  const _fPagos = [...(f.pagos||[]), { fecha: today(), hora: nowTime(), cajero: currentUser, monto, metodo }];
  const _fPagado = Math.round((f.pagado + monto) * 100) / 100;
  batch.set(docM(dbModular, 'fiados', String(f.id)), { ...f, pagado: _fPagado, pagos: _fPagos, sedeId: f.sedeId || sede });

  batch.set(docM(dbModular, 'clientes', String(f.clienteId)), {
    deudaPorSede: { [f.sedeId || sede]: incrementM(-monto) }
  }, { merge: true });

  const _movId = getId();
  const _movData = { id:_movId, tipo:'ingreso', desc:`Pago fiado (${metodo}): ` + getClienteNombre(f.clienteId), monto, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  const _cajaUpdate = { ingresos: incrementM(monto) };
  if (metodo === 'Efectivo') _cajaUpdate.ingresosEfectivo = incrementM(monto);
  batch.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });

  const _pagoFiado = { id: getId(), fecha: today(), hora: nowTime(), origen: 'pago_fiado', estado: 'completado', clienteId: f.clienteId, fiadoId: f.id, total: monto, metodo, cajero: currentUser, costoAsociado, sedeId: sede };
  batch.set(docM(dbModular, 'ventas', String(_pagoFiado.id)), _pagoFiado);

  _sincIniciar('pago_fiado_lote', f.id);
  try {
    await batch.commit();
    _sincTerminar('pago_fiado_lote', f.id);
  } catch (e) {
    _sincError('pago_fiado_lote', f.id, e, 'el pago del fiado — no se aplicó nada');
    return;
  }

  // El lote ya fue aceptado — recien ahora se refleja en memoria local.
  if (!f.pagos) f.pagos = [];
  f.pagos.push({ fecha: today(), hora: nowTime(), cajero: currentUser, monto, metodo });
  f.pagado = _fPagado;
  const cli = DB.clientes.find(c => c.id === f.clienteId);
  if (cli) {
    _clienteProxySkipSync = true;
    try { _aplicarDeudaLocal(cli, f.sedeId || sede, -monto); }
    finally { _clienteProxySkipSync = false; }
  }
  // Caja es un objeto plano — esta asignacion solo actualiza la copia local.
  DB.caja.ingresos += monto;
  if (metodo === 'Efectivo') DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + monto;
  
  if (!DB.historialVentas) DB.historialVentas = [];
  DB.historialVentas.push(_pagoFiado);
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
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
  const pendiente = Math.round((f.total - f.pagado) * 100) / 100;
  if (pendiente <= 0) { alert('Este fiado ya está pagado — no hay deuda que recordar.'); return; }
  const cli = DB.clientes.find(c => c.id === f.clienteId);
  const nombre = cli ? (cli.alias || cli.nombre) : 'Cliente';
  const tel = cli && cli.tel ? cli.tel.replace(/\s/g,'') : '';
  const itemsPend = f.items.map(i => `• ${i.nombre} x${i.cant} = ${sol(i.precio*i.cant)}`).join('\n');
  const msg = `Hola ${nombre}, le recordamos su deuda en *${DB.config.nombre||'Tienda Aleze'}*:\n\n${itemsPend}\n\n*Total pendiente: ${sol(pendiente)}*\n\nGracias 🙏`;
  const url = tel ? `https://wa.me/51${tel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
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
  if (tipo === 'pendientes') fiados = fiados.filter(f => (f.total - f.pagado) > 0);
  else if (tipo === 'pagados') fiados = fiados.filter(f => (f.total - f.pagado) <= 0);

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
            <div style="font-size:.72rem;color:var(--gray-500)">${p.items.map(i=>i.nombre).join(', ')}</div>
          </div>
          <strong style="color:var(--accent);font-size:.95rem">+${sol(p.monto)}</strong>
        </div>`).join('');
    return;
  }

  const totalPend = fiados.reduce((s, f) => s + Math.max(0, f.total - f.pagado), 0);
  document.getElementById('hcli-resumen-filtro').textContent = `${fiados.length} venta(s) encontrada(s) · Pendiente: ${sol(totalPend)}`;
  contenido.innerHTML = fiados.length === 0
    ? '<p style="color:var(--gray-400);text-align:center;padding:1rem">Sin registros para los filtros seleccionados</p>'
    : [...fiados].sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id).map(f => {
        const pend = f.total - f.pagado;
        const pagosF = (f.pagos || []);
        return `<div style="border-left:3px solid ${pend>0?'var(--warning)':'var(--accent)'};padding:.6rem .75rem;margin-bottom:.6rem;background:white;border-radius:0 6px 6px 0;box-shadow:var(--shadow)">
          <div style="display:flex;justify-content:space-between;margin-bottom:.3rem">
            <span style="font-size:.75rem;color:var(--gray-500)">📅 ${formatDate(f.fecha)}</span>
            <span style="font-weight:700;font-size:.85rem;color:${pend>0?'var(--danger)':'var(--accent)'}">
              ${pend > 0 ? sol(pend)+' pendiente' : '✅ Saldado'}
            </span>
          </div>
          <div style="font-size:.8rem;margin-bottom:.3rem">${f.items.map(i=>`${i.nombre} x${i.cant} = ${sol(i.precio*i.cant)}`).join(' · ')}</div>
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
    if (tipo === 'pendientes') fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) > 0);
    else if (tipo === 'pagados') fiados = fiados.filter(f => (Math.round((f.total - f.pagado) * 100) / 100) <= 0);
    const totalPend = Math.round(fiados.reduce((s, f) => s + Math.max(0, f.total - f.pagado), 0) * 100) / 100;
    fiados.forEach(f => {
      const pend = Math.round((f.total - f.pagado) * 100) / 100;
      msg += `📌 ${formatDate(f.fecha)}: ${f.items.map(i=>`${i.nombre} x${i.cant}`).join(', ')} → ${sol(f.total)}`;
      msg += pend > 0 ? ` _(pendiente: ${sol(pend)})_\n` : ` ✅\n`;
    });
    if (tipo !== 'pagados') msg += `\n*Total pendiente: ${sol(totalPend)}*\n`;
  }
  msg += '\nGracias 🙏';
  const url = tel ? `https://wa.me/51${tel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// ===================== WHATSAPP IMAGEN =====================
async function compartirWhatsapp() {
  const ticket = document.getElementById('ticket-print');
  if (!ticket) { alert('Sin ticket disponible'); return; }
  try {
    if (!window.html2canvas) { await new Promise(res => _loadHtml2Canvas(res)); }
    const canvas = await html2canvas(ticket, { scale: 2, backgroundColor: '#ffffff' });
    canvas.toBlob(blob => {
      const file = new File([blob], 'ticket-aleze.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: 'Ticket ' + (DB.config.nombre||'Tienda Aleze'), files: [file] })
          .catch(() => fallbackWA());
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'ticket-aleze.png'; a.click();
        setTimeout(() => window.open('https://wa.me/', '_blank'), 600);
        alert('Imagen descargada. Compártela por WhatsApp.');
      }
    }, 'image/png');
  } catch(e) { fallbackWA(); }
}

function fallbackWA() {
  const t = document.getElementById('ticket-print');
  window.open('https://wa.me/?text=' + encodeURIComponent(t ? t.innerText : ''), '_blank');
}

// ===================== FRECUENTES =====================
// ── Fidelización: configuración de puntos, premios, multiplicadores y su historial ──
function renderFidelizacionConfig() {
  document.getElementById('fid-tasa-base').value = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.tasaBase) || 1;
  document.getElementById('fid-ventana-aviso').value = (DB_EXT.fidelizacion && DB_EXT.fidelizacion.ventanaAviso) || 300;
  renderPremiosFidelizacion();
  renderMultiplicadoresCategorias();
  renderCanjesHistorial();
}

function guardarFidelizacionConfig() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede cambiar las reglas del programa de puntos.'); return; }
  const tasaBase = parseFloat(document.getElementById('fid-tasa-base').value) || 1;
  const ventanaAviso = parseFloat(document.getElementById('fid-ventana-aviso').value) || 300;
  DB_EXT.fidelizacion = { tasaBase, ventanaAviso };
  fbGuardarExt();
  alert('✅ Configuración guardada.');
}

function _toggleCamposPremio() {
  const tipo = document.getElementById('fid-nuevo-premio-tipo').value;
  document.getElementById('fid-nuevo-premio-desc-wrap').style.display = tipo === 'descuento' ? 'block' : 'none';
  const prodWrap = document.getElementById('fid-nuevo-premio-prod-wrap');
  prodWrap.style.display = tipo === 'producto' ? 'block' : 'none';
  if (tipo === 'producto') {
    const sel = document.getElementById('fid-nuevo-premio-prod');
    if (!sel.options.length) sel.innerHTML = DB.productos.map(p => `<option value="${p.id}">${p.nombre} (costo S/${p.costo})</option>`).join('');
  }
}

function renderPremiosFidelizacion() {
  const el = document.getElementById('fid-premios-list');
  const premios = DB_EXT.premiosFidelizacion || [];
  if (!premios.length) { el.innerHTML = '<div style="color:var(--gray-400);padding:.5rem">Sin premios configurados — agrega el primero abajo.</div>'; return; }
  el.innerHTML = [...premios].sort((a,b)=>a.puntos-b.puntos).map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--gray-100)">
      <span><strong>${p.puntos} pts</strong> — ${p.tipo==='producto'?'📦':'💰'} ${p.nombre}</span>
      <button type="button" class="btn btn-xs btn-danger" onclick="eliminarPremioFidelizacion(${p.id})">✕</button>
    </div>`).join('');
}

function agregarPremioFidelizacion() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede agregar premios del programa de puntos.'); return; }
  const puntos = parseInt(document.getElementById('fid-nuevo-premio-puntos').value);
  const tipo = document.getElementById('fid-nuevo-premio-tipo').value;
  const nombre = document.getElementById('fid-nuevo-premio-nombre').value.trim();
  if (!puntos || puntos <= 0 || !nombre) { alert('Completa puntos y nombre del premio.'); return; }
  const premio = { id: getId(), puntos, nombre, tipo };
  if (tipo === 'descuento') {
    premio.monto = parseFloat(document.getElementById('fid-nuevo-premio-monto').value) || 0;
    if (premio.monto <= 0) { alert('Ingresa el monto del descuento.'); return; }
  } else {
    premio.prodId = parseInt(document.getElementById('fid-nuevo-premio-prod').value) || null;
    if (!premio.prodId) { alert('Selecciona el producto.'); return; }
  }
  if (!DB_EXT.premiosFidelizacion) DB_EXT.premiosFidelizacion = [];
  DB_EXT.premiosFidelizacion.push(premio);
  fbGuardarExt();
  document.getElementById('fid-nuevo-premio-puntos').value = '';
  document.getElementById('fid-nuevo-premio-nombre').value = '';
  document.getElementById('fid-nuevo-premio-monto').value = '';
  renderPremiosFidelizacion();
}

function eliminarPremioFidelizacion(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar premios del programa de puntos.'); return; }
  if (!confirm('¿Eliminar este premio?')) return;
  DB_EXT.premiosFidelizacion = (DB_EXT.premiosFidelizacion||[]).filter(p => p.id !== id);
  fbGuardarExt();
  renderPremiosFidelizacion();
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
        📅 ${formatDate(c.fecha)} — <strong>${getClienteNombre(c.clienteId)}</strong> canjeó <strong>${c.premioNombre}</strong> (${c.puntosUsados} pts)
      </div>`;
    }).join('');
  }).catch(() => { el.innerHTML = 'Error cargando canjes.'; });
}

function renderFrecuentes() {
  renderFidelizacionConfig();
  // Niveles
  document.getElementById('niveles-display').innerHTML = DB_EXT.niveles.map(n => `
    <div class="card" style="text-align:center;border-top:4px solid var(--primary)">
      <div style="font-size:1.5rem">🎁</div>
      <div style="font-weight:700;font-size:.88rem;margin:.3rem 0">+S/ ${n.umbral}</div>
      <div class="badge badge-gold">Hasta S/ ${n.max}</div>
      <div style="font-size:.72rem;color:var(--gray-500);margin-top:.3rem">${n.desc}</div>
    </div>`).join('');
  // Navidad
  const ng = parseInt(DB_EXT.navidad.n) || 3;
  const top = [...DB.clientes].filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, ng);
  const crowns = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  document.getElementById('ranking-navidad').innerHTML = `
    <p style="font-size:.82rem;color:var(--gray-600);margin-bottom:.75rem">Top ${ng} clientes del año reciben canasta de hasta <strong>S/ ${DB_EXT.navidad.valor}</strong></p>
    <div style="display:flex;gap:.75rem;flex-wrap:wrap">
      ${top.map((c,i) => `
        <div class="card" style="text-align:center;min-width:140px;border-top:4px solid ${i===0?'#F59E0B':i===1?'#9CA3AF':'#92400E'}">
          <div style="font-size:2rem">${crowns[i]}</div>
          <div style="font-weight:700;font-size:.9rem">${c.alias||c.nombre}</div>
          <div style="color:var(--primary);font-weight:700">${sol(c.total)}</div>
          <div class="badge badge-gold" style="margin-top:.3rem">🎄 S/ ${DB_EXT.navidad.valor}</div>
        </div>`).join('')}
    </div>`;
  // Ranking completo
  const todos = [...DB.clientes].sort((a, b) => b.total - a.total);
  document.getElementById('ranking-table').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Cliente</th><th>Alias</th><th>Consumo año</th><th>Nivel</th><th>Premio disponible</th></tr></thead>
      <tbody>${todos.map((c, i) => {
        const nv = getNivel(c.total);
        const pct = nv ? Math.min(100, c.total / nv.umbral * 100) : Math.min(100, c.total / 100 * 100);
        return `<tr>
          <td>${crowns[i] || i+1}</td>
          <td><strong>${c.nombre || 'Cliente sin nombre'}</strong></td>
          <td><span class="badge badge-blue">${c.alias||'-'}</span></td>
          <td>
            <strong>${sol(c.total)}</strong>
            <div class="progress-bar" style="margin-top:.3rem"><div class="progress-fill" style="background:var(--primary);width:${pct}%"></div></div>
          </td>
          <td>${nv ? `<span class="badge badge-gold">${nv.desc}</span>` : '<span class="badge badge-gray">Sin nivel aún</span>'}</td>
          <td>${nv ? `<span style="color:var(--accent);font-weight:700">🎁 Hasta S/ ${nv.max}</span>` : '-'}</td>
          <td><button class="btn btn-outline btn-xs" onclick="verHistorialCliente(${c.id})">📋</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

// Premio sugerido al vender

