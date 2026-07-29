// ===================== CAJA =====================
function renderCaja() {
  const _esAdmin = currentRole === 'admin';
  const _banner = document.getElementById('caja-sede-banner');
  if (_banner) {
    if (_esAdmin && _sedeAdminOverride) {
      _banner.style.display = 'block';
      _banner.textContent = `⚠️ Estás operando la caja de "${_sedeAdminOverride}" — no la tuya. Tus ventas en POS siguen siendo de tu sede real. Cambia esto arriba, junto a tu nombre.`;
    } else {
      _banner.style.display = 'none';
    }
  }
  // Vendedor: solo lectura — ve los mismos números que admin, pero sin controles para
  // abrir/cerrar caja, retirar efectivo, ni registrar movimientos manuales.
  const _accionesAdmin = document.getElementById('caja-acciones-admin');
  if (_accionesAdmin) _accionesAdmin.style.display = _esAdmin ? '' : 'none';
  const _registrarAdmin = document.getElementById('caja-registrar-admin');
  if (_registrarAdmin) _registrarAdmin.style.display = _esAdmin ? '' : 'none';
  const _cerradaAdmin = document.getElementById('caja-cerrada-admin');
  if (_cerradaAdmin) _cerradaAdmin.style.display = _esAdmin ? '' : 'none';
  const _cerradaVendedor = document.getElementById('caja-cerrada-vendedor');
  if (_cerradaVendedor) _cerradaVendedor.style.display = _esAdmin ? 'none' : '';

  if (DB.caja.abierta) {
    document.getElementById('caja-cerrada').style.display = 'none';
    document.getElementById('caja-abierta').style.display = 'block';
    updateCajaStats();
  } else {
    document.getElementById('caja-cerrada').style.display = 'block';
    document.getElementById('caja-abierta').style.display = 'none';
    if (_esAdmin) {
      const montoAuto = parseFloat(DB.config && DB.config.montoAperturaAuto) || 0;
      const saldoHeredado = typeof DB.caja.saldoFinal === 'number' ? DB.caja.saldoFinal : montoAuto;
      const elMonto = document.getElementById('caja-monto-inicial');
      const hint = document.getElementById('caja-auto-hint');
      if (elMonto) elMonto.value = saldoHeredado;
      if (hint) hint.textContent = typeof DB.caja.saldoFinal === 'number'
        ? `Saldo real heredado del cierre anterior: S/ ${saldoHeredado.toFixed(2)} (editable si hiciste un conteo físico distinto)`
        : (montoAuto > 0 ? `Monto automático configurado: S/ ${montoAuto.toFixed(2)}` : 'Sin monto automático — configúralo en Configuración');
    }
  }
}

async function abrirCaja() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede abrir caja. Podés ver el estado actual, pero no modificarlo.'); return; }
  const monto = parseFloat(document.getElementById('caja-monto-inicial').value) || 0;
  const sede = sedeAdminEfectiva();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  // CRITICO: runTransaction() en vez de lote — garantiza que la lectura es siempre real del
  // servidor (nunca de cache), igual criterio que ensureCajaAbierta(). Si dos personas abren
  // caja al mismo instante, Firestore resuelve el orden solo, sin que se pisen entre si.
  const _movId = getId();
  let _resultado;
  _sincIniciar('apertura_caja_manual', sede);
  try {
    _resultado = await runTransactionM(dbModular, async (tx) => {
      const cajaRef = docM(dbModular, 'caja', sede);
      await tx.get(cajaRef); // lectura formal — garantiza consistencia real con el servidor
      const cajaNueva = { abierta:true, inicial:monto, inicialEfectivo:monto, ingresos:0, ingresosEfectivo:0, egresos:0, retiros:0, turnoInicio:nowTime(), cajero:currentUser, fecha:today(), apertura:'manual' };
      tx.set(cajaRef, cajaNueva);
      const _movData = { id:_movId, tipo:'ingreso', desc:'Apertura de caja', monto, hora:nowTime(), fecha:today(), sedeId: sede };
      tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
      return { cajaNueva, _movData };
    });
    _sincTerminar('apertura_caja_manual', sede);
  } catch (e) {
    _sincError('apertura_caja_manual', sede, e, 'la apertura de caja — no se aplicó nada. Revisa tu conexión e intenta de nuevo');
    return;
  }

  // La escritura real ya la hizo la transacción de arriba — esto solo actualiza la copia local.
  DB._cajas[sede] = _resultado.cajaNueva;
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_resultado._movData);
  renderCaja();
}

function guardarMontoAperturaDefault() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede configurar el monto de apertura.'); return; }
  const m = parseFloat(document.getElementById('caja-monto-inicial').value) || 0;
  DB.config.montoAperturaAuto = m;
  fbGuardar();
  const hint = document.getElementById('caja-auto-hint');
  if (hint) { hint.textContent = `✅ Monto default guardado: S/ ${m.toFixed(2)}`; hint.style.color='var(--accent)'; }
  setTimeout(() => { try { renderConfiguracion(); } catch(e){} }, 300);
}

// ── Arqueo de caja (Fase 4): compara efectivo físico contra el teórico SOLO en efectivo — ──
// Yape/tarjeta/transferencia nunca pasan por el cajón, no se cuentan acá. No bloquea el cierre.
function _saldoEfectivoTeorico() {
  return (DB.caja.inicialEfectivo ?? DB.caja.inicial ?? 0) + (DB.caja.ingresosEfectivo||0) - (DB.caja.egresosEfectivo||0) - (DB.caja.retiros||0);
}
async function abrirRetiroEfectivo() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede retirar efectivo. Podés ver el estado actual, pero no modificarlo.'); return; }
  // CRITICO: ensureCajaAbierta() (con su lectura real al servidor) va PRIMERO, antes de
  // calcular "disponible" — si esto se calculaba antes, con la cache local todavia fria,
  // podia bloquear un retiro real diciendo "no hay efectivo" aunque el servidor si lo
  // tuviera. Ahora el monto disponible siempre se calcula con el estado ya confirmado.
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta();
  const disponible = _saldoEfectivoTeorico();
  if (disponible <= 0) { alert('No hay efectivo disponible para retirar.'); return; }
  const monto = parseFloat(prompt(`Efectivo disponible en caja: ${sol(disponible)}\n\n¿Cuánto vas a retirar?`));
  if (!monto || isNaN(monto) || monto <= 0) return;
  if (monto > disponible && !confirm(`El monto supera el efectivo disponible (${sol(disponible)}). ¿Continuar de todas formas?`)) return;
  const destino = prompt('¿A dónde va? (ej. "Depósito BCP", "Guardado en casa")') || 'Sin especificar';

  // Paquete atomico: el retiro (campo de caja) y su movimiento de auditoria viajan juntos.
  const sede = sedeAdminEfectiva();
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'caja', sede),
    { retiros: incrementM(monto) }, { merge: true });
  const _movId = getId();
  const _movData = { id:_movId, tipo:'retiro', desc:`Retiro de efectivo — ${destino}`, monto, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  _sincIniciar('retiro_caja_lote', _movId);
  try {
    await batch.commit();
    _sincTerminar('retiro_caja_lote', _movId);
  } catch (e) {
    _sincError('retiro_caja_lote', _movId, e, 'el retiro de efectivo — no se aplicó nada');
    return;
  }

  // El lote ya fue aceptado — recien ahora se refleja en memoria local. Caja es un objeto
  // plano, esta asignacion solo actualiza la copia local.
  DB.caja.retiros = (DB.caja.retiros||0) + monto;
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  renderCaja();
  alert(`✅ Retiro registrado: ${sol(monto)}`);
}
function abrirModalCerrarCaja() {
  document.getElementById('cc-teorico').textContent = sol(_saldoEfectivoTeorico());
  document.getElementById('cc-contado').value = '';
  document.getElementById('cc-diferencia').textContent = '';
  document.getElementById('cc-nota-wrap').style.display = 'none';
  document.getElementById('cc-nota').value = '';
  abrirModal('modal-cerrar-caja');
}
function actualizarDiferenciaCierre() {
  const contado = parseFloat(document.getElementById('cc-contado').value);
  const diffEl = document.getElementById('cc-diferencia');
  const notaWrap = document.getElementById('cc-nota-wrap');
  if (isNaN(contado)) { diffEl.textContent = ''; notaWrap.style.display = 'none'; return; }
  const diff = Math.round((contado - _saldoEfectivoTeorico()) * 100) / 100;
  diffEl.textContent = diff === 0 ? '✅ Cuadra exacto' : (diff > 0 ? `Sobrante: +${sol(diff)}` : `Faltante: ${sol(diff)}`);
  diffEl.style.color = diff === 0 ? 'var(--accent)' : 'var(--danger)';
  notaWrap.style.display = Math.abs(diff) > 5 ? 'block' : 'none';
}
async function confirmarCierreCaja() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede cerrar caja. Podés ver el estado actual, pero no modificarlo.'); return; }
  const contado = parseFloat(document.getElementById('cc-contado').value);
  if (isNaN(contado) || contado < 0) { alert('Ingresa el efectivo contado.'); return; }
  const nota = document.getElementById('cc-nota').value.trim();
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  // CRITICO: runTransaction() en vez de lote — el saldo a cerrar se calcula DENTRO de la
  // transaccion, leyendo el estado real del servidor en ese instante (nunca de cache local
  // ni de lo que esta pantalla venia mostrando) — asi una venta de ultimo segundo, ya
  // confirmada por el servidor pero todavia no reflejada en esta pantalla, no se pierde del
  // cierre. Si dos personas cierran al mismo instante, Firestore resuelve el orden solo.
  const sede = sedeAdminEfectiva();
  let _resultado;
  _sincIniciar('cierre_caja_manual', sede);
  try {
    _resultado = await runTransactionM(dbModular, async (tx) => {
      const cajaRef = docM(dbModular, 'caja', sede);
      const snap = await tx.get(cajaRef);
      if (!snap.exists()) throw new Error('No se encontró la caja de esta sede en el servidor.'); // en modular, exists es un METODO
      const cajaServidor = snap.data();
      const saldo = (cajaServidor.inicial||0) + (cajaServidor.ingresos||0) - (cajaServidor.egresos||0);
      const saldoEfectivo = (cajaServidor.inicialEfectivo ?? cajaServidor.inicial ?? 0) + (cajaServidor.ingresosEfectivo||0) - (cajaServidor.egresosEfectivo||0) - (cajaServidor.retiros||0);
      const diff = Math.round((contado - saldoEfectivo) * 100) / 100;

      tx.set(cajaRef, { abierta:false, fechaCierre: today(), saldoFinal: saldo, saldoFinalEfectivo: contado }, { merge: true });

      const _movCierreId = getId();
      const _movCierre = { id:_movCierreId, tipo:'cierre', desc:`Cierre de caja — Saldo total: ${sol(saldo)}`, monto:saldo, hora:nowTime(), fecha:today(), sedeId: sede };
      tx.set(docM(dbModular, 'movimientos', String(_movCierreId)), _movCierre);

      let _movArqueo = null;
      if (diff !== 0) {
        const _movArqueoId = getId();
        _movArqueo = {
          id: _movArqueoId, tipo: 'arqueo',
          desc: `Arqueo — esperado ${sol(saldoEfectivo)}, contado ${sol(contado)} (${diff>0?'sobrante':'faltante'} ${sol(Math.abs(diff))})${nota?' — '+nota:''}`,
          monto: diff, hora: nowTime(), fecha: today(), usuario: currentUser, sedeId: sede
        };
        tx.set(docM(dbModular, 'movimientos', String(_movArqueoId)), _movArqueo);
      }
      return { saldo, saldoEfectivo, _movCierre, _movArqueo };
    });
    _sincTerminar('cierre_caja_manual', sede);
  } catch (e) {
    _sincError('cierre_caja_manual', sede, e, 'el cierre de caja — no se aplicó nada, la caja sigue abierta. Revisa tu conexión e intenta de nuevo');
    return;
  }

  // La transacción ya fue aceptada — recién ahora se refleja en memoria local.
  DB.caja.abierta = false;
  DB.caja.fechaCierre = today();
  DB.caja.saldoFinal = _resultado.saldo;
  DB.caja.saldoFinalEfectivo = contado;
  
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_resultado._movCierre);
  if (_resultado._movArqueo) DB.movimientos.push(_resultado._movArqueo);

  cerrarModal('modal-cerrar-caja');
  renderCaja();
}

function updateCajaStats() {
  const ingresos = DB.caja.ingresos;
  const egresos = DB.caja.egresos;
  document.getElementById('caja-inicial').textContent = sol(DB.caja.inicial);
  document.getElementById('caja-ingresos').textContent = sol(ingresos);
  document.getElementById('caja-egresos').textContent = sol(egresos);
const saldo = DB.caja.inicial + ingresos - egresos;
  const saldoEl = document.getElementById('caja-saldo');
  saldoEl.textContent = sol(saldo);
  saldoEl.style.color = saldo < 0 ? 'var(--danger)' : '';
  const efectivoEl = document.getElementById('caja-efectivo');
  const noEfectivoEl = document.getElementById('caja-noefectivo');
  if (efectivoEl) efectivoEl.textContent = sol(_saldoEfectivoTeorico());
  if (noEfectivoEl) noEfectivoEl.textContent = sol(Math.max(0, ingresos - (DB.caja.ingresosEfectivo||0)));

  const fDesde  = document.getElementById('caja-filtro-desde')?.value  || '';
  const fHasta  = document.getElementById('caja-filtro-hasta')?.value  || '';
  const fTipo   = document.getElementById('caja-filtro-tipo')?.value   || '';

  const _limiteLocalMov = new Date(); _limiteLocalMov.setDate(_limiteLocalMov.getDate() - 30);
  const _limiteLocalMovStr = _limiteLocalMov.toISOString().split('T')[0];

  if (fDesde && fDesde < _limiteLocalMovStr) {
    // Fuera de la ventana local podada (30 días) — consultar movimientos/{id} directo
    document.getElementById('caja-mov-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--gray-400)">⏳ Cargando...</td></tr>';
    _fetchMovimientosRango(fDesde, fHasta || today()).then(lista => {
      let movsVis = [...lista].reverse();
      if (fTipo) movsVis = movsVis.filter(m => m.tipo === fTipo);
      _renderMovsTabla(movsVis);
    }).catch(e => {
      console.warn('updateCajaStats: error consultando movimientos/{id}', e);
      document.getElementById('caja-mov-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--danger)">⚠️ Error cargando. Intenta de nuevo.</td></tr>';
    });
  } else {
    let movsVis = [...DB.movimientos].reverse();
    if (fDesde)  movsVis = movsVis.filter(m => m.fecha >= fDesde);
    if (fHasta)  movsVis = movsVis.filter(m => m.fecha <= fHasta);
    if (fTipo)   movsVis = movsVis.filter(m => m.tipo === fTipo);
    _renderMovsTabla(movsVis);
  }
}

// ── Fase 4: pintar tabla de movimientos — separado para reusar entre ruta local y ruta consultada ──
function _renderMovsTabla(movsVis) {
  // CRITICO: esta variable vivia en updateCajaStats() pero nunca se usaba ahi — se usa ACA,
  // para el grafico de "Ventas por metodo de pago". Como _renderMovsTabla() es una funcion
  // separada (se llama tambien desde la ruta de _fetchMovimientosRango), nunca tenia acceso
  // a esa variable — tiraba ReferenceError sin capturar, cortando la funcion a mitad de
  // camino cada vez que se pintaba Caja (por eso el grafico salia vacio, y cualquier cosa
  // que dependiera de que esta funcion terminara bien tambien se veia afectada).
  const ventasHoy = DB.historialVentas.filter(v => v.fecha === today() &&
    ((v.origen === 'pos' && v.estado === 'completado') ||
     (v.origen === 'online' && v.estado === 'completado')));
  document.getElementById('caja-mov-tbody').innerHTML = movsVis.map(m => {
    const esFiado = m.tipo === 'fiado';
    const esNeutro = esFiado || m.tipo === 'info' || m.tipo === 'arqueo' || m.tipo === 'traslado';
    const badgeColor = esNeutro ? 'gray' : (m.tipo==='ingreso'?'green':'red');
    const signo = esNeutro ? '' : (m.tipo==='ingreso'?'+':'-');
    const color = esNeutro ? 'var(--gray-500)' : (m.tipo==='ingreso'?'var(--accent)':'var(--danger)');
    return `<tr>
    <td>${m.fecha ? m.fecha + ' ' : ''}${m.hora}</td>
    <td><span class="badge badge-${badgeColor}">${m.tipo}</span></td>
    <td>${m.desc}${esFiado ? ' <span style="color:var(--gray-400);font-size:.72rem">(sin movimiento de caja)</span>' : ''}</td>
    <td style="color:${color};font-weight:700">${signo}${sol(Math.abs(m.monto))}</td>
  </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin movimientos</td></tr>';

  const metodos = {};
  ventasHoy.forEach(v => metodos[v.metodo] = (metodos[v.metodo]||0) + v.total);
  if (chartMetodos) chartMetodos.destroy();
  const _canvasMetodos = document.getElementById('chart-metodos');
  if (!_canvasMetodos) return; // defensivo: si el canvas no esta en el DOM en este momento, no truena
  const ctx2 = _canvasMetodos.getContext('2d');
  chartMetodos = new Chart(ctx2, {
    type: 'doughnut',
    data: { labels: Object.keys(metodos), datasets: [{ data: Object.values(metodos), backgroundColor: ['#7C3AED','#10B981','#F59E0B','#3B82F6','#EF4444','#8B5CF6','#06B6D4','#84CC16'] }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false }
  });
}

async function registrarMovimiento() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede registrar movimientos manuales. Podés ver el estado actual, pero no modificarlo.'); return; }
  const tipo = document.getElementById('mov-tipo').value;
  const monto = parseFloat(document.getElementById('mov-monto').value) || 0;
  const desc = document.getElementById('mov-desc').value;
  if (monto <= 0) { alert('Ingresa un monto válido'); return; }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  const sede = sedeAdminEfectiva();
  const campo = tipo === 'ingreso' ? 'ingresos' : 'egresos';
  const campoEfectivo = tipo === 'ingreso' ? 'ingresosEfectivo' : 'egresosEfectivo';
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'caja', sede), {
    [campo]: incrementM(monto),
    [campoEfectivo]: incrementM(monto)
  }, { merge: true });
  const _movId = getId();
  const _movData = { id:_movId, tipo, desc: desc || tipo, monto, hora: nowTime(), fecha: today(), sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  _sincIniciar('mov_manual_lote', _movId);
  try {
    await batch.commit();
    _sincTerminar('mov_manual_lote', _movId);
  } catch (e) {
    _sincError('mov_manual_lote', _movId, e, 'el movimiento — no se aplicó nada');
    return;
  }

  if (tipo === 'ingreso') { DB.caja.ingresos += monto; DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + monto; }
  else { DB.caja.egresos += monto; DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + monto; }
  
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  document.getElementById('mov-monto').value = ''; document.getElementById('mov-desc').value = '';
  updateCajaStats();
}

// ===================== GASTOS =====================
let chartGastos = null;

function renderGastos() {
  const mes = getMesActual();
  // Gastos variables (DB_EXT.gastos) son por sede — sueldos/recurrentes son costos
  // compartidos de todo el negocio, no atribuibles a una sola sede, quedan sin filtrar.
  const _sedeG = sedeAdminEfectiva();
  const _gastosVarSede = DB_EXT.gastos.filter(g => (g.sedeId||'principal') === _sedeG);
  const gastosMes = _gastosVarSede.filter(g => g.fecha && g.fecha.startsWith(mes));
  const totVar = gastosMes.reduce((s, g) => s + g.monto, 0);
  const totFij = DB_EXT.gastosRec.reduce((s, g) => s + g.monto, 0);
  const totSu  = Object.values(DB_EXT.sueldos).reduce((s, v) => s + v, 0);
  document.getElementById('g-mes').textContent     = sol(totVar + totFij + totSu);
  document.getElementById('g-fijos').textContent   = sol(totFij);
  document.getElementById('g-var').textContent     = sol(totVar);
  document.getElementById('g-sueldos').textContent = sol(totSu);

  document.getElementById('gastos-rec-list').innerHTML = DB_EXT.gastosRec.map(g => `
    <div class="flex-between" style="padding:.4rem 0;border-bottom:1px solid var(--gray-100)">
      <span style="font-size:.82rem">${g.tipo} — ${g.desc}</span>
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="font-weight:700">${sol(g.monto)}/mes</span>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="elimGastoRec(${g.id})">🗑️</button>
      </div>
    </div>`).join('') || '<p style="font-size:.82rem;color:var(--gray-500)">Sin gastos recurrentes configurados</p>';
// Filtros historial
  const fDesde  = document.getElementById('g-filtro-desde')?.value  || '';
  const fHasta  = document.getElementById('g-filtro-hasta')?.value  || '';
  const fBuscar = (document.getElementById('g-filtro-buscar')?.value || '').toLowerCase();
  let gastosVis = [..._gastosVarSede].reverse();
  if (fDesde)  gastosVis = gastosVis.filter(g => g.fecha >= fDesde);
  if (fHasta)  gastosVis = gastosVis.filter(g => g.fecha <= fHasta);
  if (fBuscar) gastosVis = gastosVis.filter(g =>
    _norm(g.desc||'').includes(_norm(fBuscar)) ||
_norm(g.tipo||'').includes(_norm(fBuscar)));

  document.getElementById('gastos-tbody').innerHTML = gastosVis.map(g => `
    <tr>
      <td>${formatDate(g.fecha)}</td>
      <td><span class="badge badge-orange">${g.tipo}</span></td>
      <td>${g.desc}</td>
      <td style="font-weight:700;color:var(--danger)">${sol(g.monto)}</td>
      <td>
        <button class="btn btn-xs btn-outline" onclick="editarGasto(${g.id})" title="Editar">✏️</button>
        <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);margin-left:.25rem" onclick="eliminarGasto(${g.id})" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin gastos registrados</td></tr>';
  // Chart
  const tipos = {};
  gastosMes.forEach(g => tipos[g.tipo] = (tipos[g.tipo]||0) + g.monto);
  tipos['Sueldos'] = totSu;
  tipos['Fijos recurrentes'] = totFij;
  if (chartGastos) chartGastos.destroy();
  chartGastos = new Chart(document.getElementById('chart-gastos').getContext('2d'), {
    type: 'doughnut',
    data: { labels: Object.keys(tipos), datasets: [{ data: Object.values(tipos), backgroundColor: ['#7C3AED','#EF4444','#F59E0B','#10B981','#3B82F6','#EC4899','#06B6D4'] }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false }
  });
}

let _editingGastoId = null;

function abrirModalGasto() {
  _editingGastoId = null;
  ['g-desc','g-monto'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('g-fecha').value = today();
  document.getElementById('g-tipo').value = 'Energía';
  document.getElementById('g-modal-titulo').textContent = 'Registrar Gasto';
  document.getElementById('g-btn-guardar').textContent = 'Registrar';
  // Poblar selector de recurrentes si hay alguno
  const recWrap = document.getElementById('g-rec-wrap');
  const recSel  = document.getElementById('g-rec-sel');
  if (DB_EXT.gastosRec.length > 0) {
    recSel.innerHTML = '<option value="">— Ninguna —</option>' +
      DB_EXT.gastosRec.map(g => `<option value="${g.id}">${g.tipo} — ${g.desc} (S/${g.monto})</option>`).join('');
    recWrap.style.display = '';
  } else {
    recWrap.style.display = 'none';
  }
  abrirModal('modal-gasto');
}

function onGastoRecChange() {
  const id = parseInt(document.getElementById('g-rec-sel').value);
  if (!id) return;
  const g = DB_EXT.gastosRec.find(x => x.id === id);
  if (!g) return;
  document.getElementById('g-tipo').value  = g.tipo;
  document.getElementById('g-desc').value  = g.desc;
  document.getElementById('g-monto').value = g.monto;
}

function editarGasto(id) {
  const g = DB_EXT.gastos.find(x => x.id === id);
  if (!g) return;
  _editingGastoId = id;
  document.getElementById('g-modal-titulo').textContent = 'Editar Gasto';
  document.getElementById('g-btn-guardar').textContent  = 'Guardar cambios';
  document.getElementById('g-tipo').value  = g.tipo;
  document.getElementById('g-desc').value  = g.desc;
  document.getElementById('g-monto').value = g.monto;
  document.getElementById('g-fecha').value = g.fecha;
  document.getElementById('g-rec-wrap').style.display = 'none';
  abrirModal('modal-gasto');
}

async function guardarGasto() {
  // Vendedor puede registrar gastos operativos chicos de su sede (pagar por instalar un foco,
  // etc.) sin depender de admin. Solo eliminar sigue siendo de admin.
  const monto = parseFloat(document.getElementById('g-monto').value) || 0;
  if (monto <= 0) { alert('Ingresa un monto válido'); return; }
  const tipo  = document.getElementById('g-tipo').value;
  const desc  = document.getElementById('g-desc').value;
  const fecha = document.getElementById('g-fecha').value;
  const metodo = document.getElementById('g-metodo')?.value || 'Efectivo';
  const sede = sedeAdminEfectiva();

  // Paquete atomico: el gasto, el ajuste de caja y el movimiento viajan juntos — sin esto,
  // podia salir plata de caja sin gasto que lo respalde, o quedar el gasto registrado sin
  // que caja lo refleje.
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  const batch = writeBatchM(dbModular);
  let _gastoFinal, _movDesc, _movMonto, _movTipo, _cajaUpdate = {};
  let _movData = null; // solo se crea un movimiento si realmente hay algo que registrar

  if (_editingGastoId) {
    const old = DB_EXT.gastos.find(x => x.id === _editingGastoId);
    if (!old) return;
    const diff = monto - old.monto;
    _gastoFinal = { ...old, tipo, desc, monto, fecha, metodo };
    batch.set(docM(dbModular, 'gastos', String(old.id)), _gastoFinal);
    if (diff !== 0) {
      if (diff > 0) {
        _cajaUpdate.egresos = incrementM(diff);
        if (metodo === 'Efectivo') _cajaUpdate.egresosEfectivo = incrementM(diff);
        _movTipo = 'egreso'; _movDesc = `Ajuste gasto (aumento): ${desc} (${tipo}, ${metodo})`; _movMonto = diff;
      } else {
        _cajaUpdate.egresos = incrementM(diff); // diff negativo, resta
        if (metodo === 'Efectivo') _cajaUpdate.egresosEfectivo = incrementM(diff);
        _cajaUpdate.ingresos = incrementM(Math.abs(diff));
        _cajaUpdate.ingresosEfectivo = incrementM(Math.abs(diff));
        _movTipo = 'ingreso'; _movDesc = `Ajuste gasto (reducción): ${desc} (${tipo}, ${metodo})`; _movMonto = Math.abs(diff);
      }
      batch.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });
      const _movId = getId();
      _movData = { id:_movId, tipo:_movTipo, desc:_movDesc, monto:_movMonto, hora:nowTime(), fecha:today(), usuario:currentUser, sedeId: sede };
      batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
    }
  } else {
    _gastoFinal = { id: getId(), tipo, desc, monto, fecha, metodo, sedeId: sede };
    batch.set(docM(dbModular, 'gastos', String(_gastoFinal.id)), _gastoFinal);
    _cajaUpdate.egresos = incrementM(monto);
    if (metodo === 'Efectivo') _cajaUpdate.egresosEfectivo = incrementM(monto);
    batch.set(docM(dbModular, 'caja', sede), _cajaUpdate, { merge: true });
    const _movId = getId();
    _movData = { id:_movId, tipo:'egreso', desc:`Gasto: ${desc} (${tipo}, ${metodo})`, monto, hora:nowTime(), fecha, usuario:currentUser, sedeId: sede };
    batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);
  }

  _sincIniciar('gasto_lote', _gastoFinal.id);
  try {
    await batch.commit();
    _sincTerminar('gasto_lote', _gastoFinal.id);
  } catch (e) {
    _sincError('gasto_lote', _gastoFinal.id, e, 'el gasto — no se aplicó nada');
    return;
  }

  // Caja es un objeto plano — todo el bloque de abajo solo actualiza la copia local.
  if (_editingGastoId) {
    const old = DB_EXT.gastos.find(x => x.id === _editingGastoId);
    const diff = monto - old.monto;
    old.tipo = tipo; old.desc = desc; old.monto = monto; old.fecha = fecha; old.metodo = metodo;
    if (diff !== 0) {
      if (diff > 0) {
        DB.caja.egresos = (DB.caja.egresos||0) + diff;
        if (metodo === 'Efectivo') DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + diff;
      } else {
        DB.caja.egresos = Math.max(0, (DB.caja.egresos||0) + diff);
        if (metodo === 'Efectivo') DB.caja.egresosEfectivo = Math.max(0, (DB.caja.egresosEfectivo||0) + diff);
        DB.caja.ingresos = (DB.caja.ingresos||0) + Math.abs(diff);
        DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + Math.abs(diff);
      }
    }
  } else {
    DB_EXT.gastos.push(_gastoFinal);
    DB.caja.egresos = (DB.caja.egresos||0) + monto;
    if (metodo === 'Efectivo') DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + monto;
  }
  
  if (_movData) { if (!DB.movimientos) DB.movimientos = []; DB.movimientos.push(_movData); }

  fbGuardar();
  fbGuardarExt();
  cerrarModal('modal-gasto');
  renderGastos();
  try { renderCaja(); } catch(e){}
  try { renderDashboard(); } catch(e){}
  try { generarReporte(); } catch(e){}
}

async function eliminarGasto(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede eliminar gastos. Puedes crear y editar, pero no borrar lo ya registrado.'); return; }
  const gasto = DB_EXT.gastos.find(x => x.id === id);
  if (!confirm('¿Eliminar este gasto? Se devolverá el monto al efectivo disponible como corrección.')) return;

  if (gasto && gasto.monto > 0) {
    if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
    await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
    const sede = sedeAdminEfectiva();
    // Paquete atomico: borrar el gasto, devolver el efectivo y registrar el movimiento juntos.
    const batch = writeBatchM(dbModular);
    batch.delete(docM(dbModular, 'gastos', String(id)));
    batch.set(docM(dbModular, 'caja', sede), {
      ingresos: incrementM(gasto.monto),
      ingresosEfectivo: incrementM(gasto.monto)
    }, { merge: true });
    const _movId = getId();
    const _movData = { id:_movId, tipo:'ingreso', desc:`Corrección por eliminación de gasto: ${gasto.desc} (${gasto.tipo})`, monto: gasto.monto, hora: nowTime(), fecha: today(), usuario: currentUser, sedeId: sede };
    batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

    _sincIniciar('elim_gasto_lote', id);
    try {
      await batch.commit();
      _sincTerminar('elim_gasto_lote', id);
    } catch (e) {
      _sincError('elim_gasto_lote', id, e, 'la eliminación del gasto — no se aplicó nada');
      return;
    }

    DB_EXT.gastos = DB_EXT.gastos.filter(x => x.id !== id);
    DB.caja.ingresos = (DB.caja.ingresos||0) + gasto.monto;
    DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + gasto.monto;
  
    if (!DB.movimientos) DB.movimientos = [];
    DB.movimientos.push(_movData);
    fbGuardar();
  } else {
    DB_EXT.gastos = DB_EXT.gastos.filter(x => x.id !== id);
    if (dbModular) deleteDocM(docM(dbModular, 'gastos', String(id))).catch(e => console.warn('No se pudo borrar gastos/'+id, e)); // [SDK modular]
  }
  fbGuardarExt();
  renderGastos();
  try { renderCaja(); } catch(e){}
  try { renderDashboard(); } catch(e){}
  try { generarReporte(); } catch(e){}
}
function abrirModalGastoRec() {
  ['gr-desc','gr-monto'].forEach(id => document.getElementById(id).value = '');
  abrirModal('modal-gasto-rec');
}

function guardarGastoRec() {
  const desc  = document.getElementById('gr-desc').value.trim();
  const monto = parseFloat(document.getElementById('gr-monto').value) || 0;
  if (!desc || monto <= 0) { alert('Completa los campos'); return; }
  DB_EXT.gastosRec.push({ id: getId(), desc, tipo: document.getElementById('gr-tipo').value, monto });
  fbGuardarExt();
  cerrarModal('modal-gasto-rec');
  renderGastos();
}

function elimGastoRec(id) {
  if (!confirm('¿Eliminar este gasto recurrente?')) return;
  DB_EXT.gastosRec = DB_EXT.gastosRec.filter(g => g.id !== id);
  fbGuardarExt();
  renderGastos();
}
// ===================== CAPITAL =====================
function renderCapital() {
  document.getElementById('cap-inp-total').value   = DB_EXT.capital.total;
  document.getElementById('cap-inp-prestamo').value = DB_EXT.capital.prestamo || 0;
  document.getElementById('cap-inp-cuota').value   = DB_EXT.capital.cuota;
  document.getElementById('cap-inp-meta').value    = DB_EXT.capital.meta;
  updateCapStats();
}

// ── Trae ventas del rango una sola vez (Cobrado, caja real) — usado por Capital y Cierre de mes ──
async function _cargarCobradoRango(desde, hasta) {
  const lista = await _fetchVentasRango(desde, hasta);
  return lista.filter(v => (v.origen==='pos'&&v.estado==='completado')||(v.origen==='online'&&v.estado==='completado')||(v.origen==='pago_fiado'&&v.estado==='completado'));
}
// Costo de una venta cobrada: si tiene items, directo; si es pago de fiado (sin items), busca el fiado
// original en DB.fiados y prorratea el costo según cuánto se cobró de esta vez — mismo criterio que ya usa Dashboard.
function _costoDeVenta(v) {
  if (v.items && v.items.length) {
    return v.items.reduce((s,i) => { const p = DB.productos.find(x=>x.id===i.prodId); return s + (p?p.costo*i.cant:0); }, 0);
  }
  if (v.origen === 'pago_fiado') {
    // Costo real guardado al momento del pago — si no existe (pago anterior a este arreglo), se aproxima por proporción.
    if (v.costoAsociado != null) return v.costoAsociado;
    const fiado = (v.fiadoId ? DB.fiados.find(f => f.id === v.fiadoId) : null) || DB.fiados.find(f => f.clienteId === v.clienteId && f.total > 0);
    if (!fiado || !fiado.total) return 0;
    const prop = Math.min(1, v.total / fiado.total);
    return (fiado.items||[]).reduce((s,i) => s + ((i.costoUnitario||0) * i.cant * prop), 0);
  }
  return 0;
}

async function updateCapStats() {
  const prestamo      = DB_EXT.capital.prestamo     || 0;
  const prestamoPagado= DB_EXT.capital.prestamoPagado|| 0;
  const prestamoPend  = Math.max(0, prestamo - prestamoPagado);
  const capitalReal   = DB_EXT.capital.total - prestamoPend + DB_EXT.capital.recuperado;
  const pct = prestamo > 0 ? Math.min(100, prestamoPagado / prestamo * 100) : 0;

  // Stat cards
  document.getElementById('cap-total').textContent = sol(DB_EXT.capital.total);
  const recupEl = document.getElementById('cap-recup');
  recupEl.textContent   = sol(DB_EXT.capital.recuperado);
  recupEl.style.color   = DB_EXT.capital.recuperado < 0 ? 'var(--danger)' : '';
  document.getElementById('cap-pend').textContent  = prestamo > 0 ? sol(prestamoPend) : '—';
  document.getElementById('cap-real').textContent  = sol(capitalReal);

  // Barra préstamo
  document.getElementById('cap-prog').style.width = pct + '%';
  document.getElementById('cap-pct').textContent  = prestamo > 0 ? pct.toFixed(1) + '% pagado' : '—';
  document.getElementById('cap-meta-lbl').textContent = prestamo > 0
    ? `Pagado: ${sol(prestamoPagado)} / ${sol(prestamo)}`
    : 'Préstamo: S/ 0.00';

  // Panel rentabilidad — mes y año, una sola consulta (el año contiene al mes)
  const mes = getMesActual();
  const anio = today().substring(0,4);
  let cobradoAnio;
  try {
    cobradoAnio = await _cargarCobradoRango(anio + '-01-01', today());
  } catch (e) {
    console.warn('updateCapStats: error consultando ventas/{id}', e);
    document.getElementById('rent-real-detalle').innerHTML = '<div style="padding:1rem;text-align:center;color:var(--danger)">⚠️ Error cargando rentabilidad. Intenta de nuevo.</div>';
    return;
  }
  const cobradoMes = cobradoAnio.filter(v => v.fecha && v.fecha.startsWith(mes));

  const ventasMes = cobradoMes.reduce((s,v) => s+v.total, 0);
  const costoMes  = cobradoMes.reduce((s,v) => s+_costoDeVenta(v), 0);
  const gastosMes  = DB_EXT.gastos.filter(g => g.fecha && g.fecha.startsWith(mes)).reduce((s,g) => s+g.monto, 0);
  const gastosRec  = DB_EXT.gastosRec.reduce((s,g) => s+g.monto, 0);
  const sueldosMes = Object.values(DB_EXT.sueldos).reduce((s,v) => s+v, 0);
  const mermasMes  = DB.mermas.filter(m => m.fecha && m.fecha.startsWith(mes))
    .reduce((s,m) => { const p=DB.productos.find(x=>x.id===m.prodId); return s+(p?p.costo*m.cant:0); }, 0);
  const totalGastos = gastosMes + gastosRec + sueldosMes;
  const ganBruta    = ventasMes - costoMes;
  const rentReal    = ganBruta - totalGastos - mermasMes - DB_EXT.capital.cuota;
  const deficit     = rentReal - DB_EXT.capital.meta;
  const reinvertir  = Math.max(0, DB_EXT.capital.total * 0.1);

  const ventasAnio = cobradoAnio.reduce((s,v) => s+v.total, 0);
  const costoAnio  = cobradoAnio.reduce((s,v) => s+_costoDeVenta(v), 0);
  const gastosAnio = DB_EXT.gastos.filter(g => g.fecha && g.fecha.startsWith(anio)).reduce((s,g) => s+g.monto, 0);
  const mermasAnio = DB.mermas.filter(m => m.fecha && m.fecha.startsWith(anio))
    .reduce((s,m) => { const p=DB.productos.find(x=>x.id===m.prodId); return s+(p?p.costo*m.cant:0); }, 0);
  const rentAnio = (ventasAnio - costoAnio) - gastosAnio - mermasAnio;

  document.getElementById('rent-real-detalle').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.5rem;font-size:.85rem">
      <div style="font-size:.78rem;font-weight:700;color:var(--gray-500);margin-bottom:.2rem">📅 Mes actual (${mes})</div>
      <div class="flex-between"><span>Ventas:</span><span style="color:var(--accent);font-weight:700">${sol(ventasMes)}</span></div>
      <div class="flex-between"><span>Costo productos:</span><span style="color:var(--danger)">-${sol(costoMes)}</span></div>
      <div class="flex-between"><span>Gastos operativos:</span><span style="color:var(--danger)">-${sol(totalGastos)}</span></div>
      <div class="flex-between"><span>Mermas:</span><span style="color:var(--danger)">-${sol(mermasMes)}</span></div>
      <div class="flex-between"><span>Cuota préstamo ref.:</span><span style="color:var(--danger)">-${sol(DB_EXT.capital.cuota)}</span></div>
      <div style="border-top:2px solid var(--gray-200);padding-top:.5rem" class="flex-between">
        <strong>Rentabilidad real:</strong>
        <strong style="color:${rentReal>=0?'var(--accent)':'var(--danger)'}">${sol(rentReal)}</strong>
      </div>
      <div class="flex-between">
        <span>vs. meta (${sol(DB_EXT.capital.meta)}):</span>
        <span style="color:${deficit>=0?'var(--accent)':'var(--danger)'};font-weight:700">
          ${deficit>=0?'✅ +'+sol(deficit):'❌ '+sol(deficit)}
        </span>
      </div>
      <div style="border-top:2px solid var(--gray-200);padding-top:.5rem;margin-top:.25rem">
        <div style="font-size:.78rem;font-weight:700;color:var(--gray-500);margin-bottom:.3rem">📊 Acumulado ${anio}</div>
        <div class="flex-between"><span>Ventas año:</span><span style="color:var(--accent);font-weight:700">${sol(ventasAnio)}</span></div>
        <div class="flex-between"><span>Ganancia neta año:</span><span style="color:${rentAnio>=0?'var(--accent)':'var(--danger)'};font-weight:700">${sol(rentAnio)}</span></div>
      </div>
      <div style="background:var(--info-light);border-radius:8px;padding:.65rem;margin-top:.4rem">
        <div style="font-size:.78rem;font-weight:700;color:var(--info);margin-bottom:.3rem">💡 Sugerencia de reinversión</div>
        <div style="font-size:.78rem;color:var(--gray-700)">
          Reinvertir aprox. ${sol(reinvertir)} (10% del capital) priorizando:
          ${DB.productos.filter(p=>stockEnSede(p)<=p.stockMin).slice(0,3).map(p=>p.nombre).join(', ') || 'productos con stock bajo'}
        </div>
      </div>
    </div>`;

  // Historial con tipos coloreados
  const tipoConfig = {
    aporte:        { icon:'💰', color:'var(--info)' },
    ganancia:      { icon:'📈', color:'var(--accent)' },
    pago_prestamo: { icon:'🏦', color:'var(--danger)' }
  };
  document.getElementById('cap-hist-tbody').innerHTML = [...DB_EXT.capital.hist].reverse().map(h => {
    const tc = tipoConfig[h.tipo] || { icon:'💰', color:'var(--gray-600)' };
    return `<tr>
      <td>${formatDate(h.fecha)}</td>
      <td><span style="color:${tc.color};font-weight:600">${tc.icon} ${h.tipo==='aporte'?'Aporte':h.tipo==='ganancia'?'Ganancia':h.tipo==='pago_prestamo'?'Pago préstamo':'Aporte'}</span></td>
      <td>${h.desc}</td>
      <td style="color:${h.monto>=0?'var(--accent)':'var(--danger)'};font-weight:700">${h.monto>=0?'+':''}${sol(h.monto)}</td>
      <td>${sol(h.acum)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--gray-400)">Sin historial</td></tr>';
}

function guardarCapital() {
  DB_EXT.capital.total   = parseFloat(document.getElementById('cap-inp-total').value)   || 0;
  DB_EXT.capital.prestamo= parseFloat(document.getElementById('cap-inp-prestamo').value) || 0;
  DB_EXT.capital.cuota   = parseFloat(document.getElementById('cap-inp-cuota').value)   || 0;
  DB_EXT.capital.meta    = parseFloat(document.getElementById('cap-inp-meta').value)    || 0;
  if (!DB_EXT.capital.hist.length && DB_EXT.capital.total > 0) {
    DB_EXT.capital.hist.push({ tipo:'aporte', fecha: today(), desc: 'Capital inicial', monto: DB_EXT.capital.total, acum: DB_EXT.capital.total });
  }
  fbGuardarExt();
  updateCapStats();
  alert('✅ Configuración guardada');
}

function abrirAddCapital() {
  document.getElementById('ac-monto').value = '';
  document.getElementById('ac-desc').value  = '';
  abrirModal('modal-add-capital');
}

async function confirmarAddCapital() {
  const monto = parseFloat(document.getElementById('ac-monto').value) || 0;
  const desc  = document.getElementById('ac-desc').value || 'Capital adicional';
  if (monto <= 0) { alert('Monto inválido'); return; }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  const sede = sedeAdminEfectiva();
  // Capital vive en db_ext (sin colección propia) — se empaqueta lo que sí tiene colección
  // dedicada (caja + movimiento) en un lote; fbGuardarExt() sigue guardando el capital como ya lo hacía.
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'caja', sede), {
    ingresos: incrementM(monto),
    ingresosEfectivo: incrementM(monto)
  }, { merge: true });
  const _movId = getId();
  const _movData = { id:_movId, tipo:'ingreso', desc:'Aporte de capital: '+desc, monto, hora:nowTime(), fecha:today(), usuario:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  _sincIniciar('add_capital_lote', _movId);
  try {
    await batch.commit();
    _sincTerminar('add_capital_lote', _movId);
  } catch (e) {
    _sincError('add_capital_lote', _movId, e, 'el aporte de capital — no se aplicó nada');
    return;
  }

  DB_EXT.capital.total += monto;
  const acum = DB_EXT.capital.hist.reduce((s,h) => s+h.monto, 0) + monto;
  DB_EXT.capital.hist.push({ tipo:'aporte', fecha: today(), desc, monto, acum });
  DB.caja.ingresos = (DB.caja.ingresos||0) + monto;
  DB.caja.ingresosEfectivo = (DB.caja.ingresosEfectivo||0) + monto;
  
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  fbGuardarExt();
  cerrarModal('modal-add-capital');
  renderCapital();
  try { renderCaja(); } catch(e){}
  try { renderDashboard(); } catch(e){}
}

async function abrirCerrarMes() {
  const mes = getMesActual();
  document.getElementById('cm-mes').value = mes;
  document.getElementById('cm-monto').value = '';
  document.getElementById('cm-detalle').textContent = '⏳ Calculando...';
  abrirModal('modal-cerrar-mes');

  let cobradoMes;
  try {
    cobradoMes = await _cargarCobradoRango(mes + '-01', today());
  } catch (e) {
    document.getElementById('cm-detalle').textContent = '⚠️ Error cargando datos. Cierra y vuelve a intentar.';
    return;
  }
  const ventasMes = cobradoMes.reduce((s,v) => s+v.total, 0);
  const costoMes  = cobradoMes.reduce((s,v) => s+_costoDeVenta(v), 0);
  const gastosMes  = DB_EXT.gastos.filter(g => g.fecha && g.fecha.startsWith(mes)).reduce((s,g) => s+g.monto, 0);
  const gastosRec  = DB_EXT.gastosRec.reduce((s,g) => s+g.monto, 0);
  const sueldosMes = Object.values(DB_EXT.sueldos).reduce((s,v) => s+v, 0);
  const mermasMes  = DB.mermas.filter(m => m.fecha && m.fecha.startsWith(mes))
    .reduce((s,m) => { const p=DB.productos.find(x=>x.id===m.prodId); return s+(p?p.costo*m.cant:0); }, 0);
  const ganancia = (ventasMes - costoMes) - gastosMes - gastosRec - sueldosMes - mermasMes;
  document.getElementById('cm-monto').value = ganancia.toFixed(2);
  document.getElementById('cm-detalle').textContent =
    `Ventas ${sol(ventasMes)} − Costos ${sol(costoMes)} − Gastos ${sol(gastosMes+gastosRec+sueldosMes)} − Mermas ${sol(mermasMes)}`;
}

function confirmarCerrarMes() {
  const mes   = document.getElementById('cm-mes').value;
  const monto = parseFloat(document.getElementById('cm-monto').value) || 0;
  if (!mes) { alert('Selecciona el mes'); return; }
  // Evitar doble cierre del mismo mes
  const yaExiste = DB_EXT.capital.hist.some(h => h.tipo === 'ganancia' && h.fecha && h.fecha.startsWith(mes));
  if (yaExiste) { alert('⚠️ Este mes ya fue cerrado. Revisa el historial.'); return; }
  DB_EXT.capital.recuperado += monto;
  const acum = DB_EXT.capital.hist.reduce((s,h) => s+h.monto, 0) + monto;
  DB_EXT.capital.hist.push({ tipo:'ganancia', fecha: mes+'-01', desc: 'Ganancia mensual — '+mes, monto, acum });
  fbGuardarExt();
  cerrarModal('modal-cerrar-mes');
  renderCapital();
  try { renderDashboard(); } catch(e){}
  alert('✅ Ganancia del mes registrada: '+sol(monto));
}

function abrirPagoCuota() {
  document.getElementById('pc-fecha').value = today();
  document.getElementById('pc-monto').value = DB_EXT.capital.cuota || '';
  document.getElementById('pc-desc').value  = '';
  const ref = document.getElementById('pc-ref');
  if (ref && DB_EXT.capital.cuota > 0) ref.textContent = '(cuota ref: '+sol(DB_EXT.capital.cuota)+')';
  abrirModal('modal-pago-cuota');
}

async function confirmarPagoCuota() {
  const monto = parseFloat(document.getElementById('pc-monto').value) || 0;
  const fecha = document.getElementById('pc-fecha').value || today();
  const desc  = document.getElementById('pc-desc').value.trim() || 'Pago préstamo '+fecha.substring(0,7);
  if (monto <= 0) { alert('Ingresa un monto válido'); return; }
  const prestamoPend = Math.max(0, (DB_EXT.capital.prestamo||0) - (DB_EXT.capital.prestamoPagado||0));
  if (DB_EXT.capital.prestamo > 0 && monto > prestamoPend) {
    alert('El monto supera el préstamo pendiente de '+sol(prestamoPend)); return;
  }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de armar el lote — ver nota en ensureCajaAbierta()
  const sede = sedeAdminEfectiva();
  const batch = writeBatchM(dbModular);
  batch.set(docM(dbModular, 'caja', sede), {
    egresos: incrementM(monto),
    egresosEfectivo: incrementM(monto)
  }, { merge: true });
  const _movId = getId();
  const _movData = { id:_movId, tipo:'egreso', desc:'Pago préstamo: '+desc, monto, hora:nowTime(), fecha, usuario:currentUser, sedeId: sede };
  batch.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

  _sincIniciar('pago_cuota_lote', _movId);
  try {
    await batch.commit();
    _sincTerminar('pago_cuota_lote', _movId);
  } catch (e) {
    _sincError('pago_cuota_lote', _movId, e, 'el pago de la cuota — no se aplicó nada');
    return;
  }

  DB_EXT.capital.prestamoPagado = (DB_EXT.capital.prestamoPagado||0) + monto;
  const acum = DB_EXT.capital.hist.reduce((s,h) => s+h.monto, 0) - monto;
  DB_EXT.capital.hist.push({ tipo:'pago_prestamo', fecha, desc, monto: -monto, acum });
  DB.caja.egresos = (DB.caja.egresos||0) + monto;
  DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + monto;
  
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_movData);
  fbGuardarExt();
  cerrarModal('modal-pago-cuota');
  renderCapital();
  try { renderCaja(); } catch(e){}
  try { renderDashboard(); } catch(e){}
  alert('✅ Pago registrado: '+sol(monto)+'. Préstamo pendiente: '+sol(Math.max(0,(DB_EXT.capital.prestamo||0)-(DB_EXT.capital.prestamoPagado||0))));
}

