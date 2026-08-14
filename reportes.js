// ===================== REPORTES =====================
function initReportes() {
  setPeriodoReporte();
}

function setPeriodoReporte() {
  const periodo = document.getElementById('rep-periodo')?.value || 'mes';
  const hoy = today();
  let desde, hasta = hoy;
if (periodo === 'todos') { desde = '2000-01-01'; hasta = '2099-12-31'; }
  else if (periodo === 'hoy') { desde = hoy; }
  else if (periodo === 'semana') { const d = new Date(); d.setDate(d.getDate()-7); desde = d.toISOString().split('T')[0]; }
  else if (periodo === 'mes') { desde = hoy.substring(0,7) + '-01'; }
  else if (periodo === 'anual') { desde = hoy.substring(0,4) + '-01-01'; }
  else { desde = document.getElementById('rep-desde').value || hoy.substring(0,7)+'-01'; hasta = document.getElementById('rep-hasta').value || hoy; }
  document.getElementById('rep-desde').value = desde;
  document.getElementById('rep-hasta').value = hasta;
  generarReporte();
}

// ── Fase 2 Reportes: trae ventas del rango UNA vez; cada reporte deriva vendido/cobrado ──
// vendido = devengado (incluye fiado creado, con items — excluye el registro de pago, que no tiene items y duplicaría el ingreso)
// cobrado = caja real (mismo filtro que ya usa Dashboard)
async function _cargarVentasReporte(desde, hasta, sede) {
  let lista = await _fetchVentasRango(desde, hasta);
  if (sede) lista = lista.filter(v => (v.sedeId||'principal') === sede);
  const vendido = lista.filter(v => v.origen !== 'pago_fiado');
  const cobrado = lista.filter(v => (v.origen==='pos'&&v.estado==='completado')||(v.origen==='online'&&v.estado==='completado')||(v.origen==='pago_fiado'&&v.estado==='completado'));
  return { vendido, cobrado };
}

async function generarReporte() {
  const tipo = document.getElementById('rep-tipo').value;
  const desde = document.getElementById('rep-desde').value;
  const hasta = document.getElementById('rep-hasta').value;
  const sede  = document.getElementById('rep-sede')?.value || '';
  if (tipo === 'todos-tipos') {
    document.getElementById('rep-stats').innerHTML = '<div class="stat-card blue"><div class="stat-label">Modo exportación</div><div class="stat-value" style="font-size:1rem">📊 Todos los reportes</div></div>';
    document.getElementById('rep-tabla-titulo').textContent = 'Exportación completa';
    document.getElementById('rep-tabla-wrap').innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--gray-500);font-size:.9rem">Haz clic en <strong>📥 Exportar Excel</strong> para descargar las 6 hojas:<br><br><span style="color:var(--accent)">Ventas · Productos · Rentabilidad · Mermas · Fiados · Gastos</span></div>';
    if (chartReporte) { chartReporte.destroy(); chartReporte = null; }
    return;
  }
  if (tipo === 'mermas') { reporteMermas(desde, hasta, sede); return; }
  if (tipo === 'fiados') { reporteFiados(sede); return; }
  if (tipo === 'gastos') { reporteGastos(desde, hasta, sede); return; }
  if (tipo === 'fidelizacion') { reporteFidelizacion(desde, hasta, sede); return; }

  // Solo ventas/productos/rentabilidad consultan ventas/{id}
  const diasRango = Math.round((new Date(hasta) - new Date(desde)) / 86400000);
  if (diasRango > 30) {
    if (!confirm(`El rango elegido es de ${diasRango} días — trae más datos de lo normal (más tráfico/lecturas). ¿Continuar?`)) return;
  }
  const wrap = document.getElementById('rep-tabla-wrap');
  if (wrap) wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--gray-400)">⏳ Cargando...</div>';
  document.getElementById('rep-stats').innerHTML = '';

  let datos;
  try {
    datos = await _cargarVentasReporte(desde, hasta, sede);
  } catch (e) {
    console.warn('generarReporte: error consultando ventas/{id}', e);
    if (wrap) wrap.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--danger)">⚠️ Error cargando reporte. Intenta de nuevo.</div>';
    return;
  }

  if (tipo === 'ventas') reporteVentas(datos);
  else if (tipo === 'productos') reporteProductos(datos);
  else if (tipo === 'rentabilidad') reporteRentabilidad(datos, desde, hasta);
}

function reporteVentas(datos) {
  const { vendido, cobrado } = datos;
  const porDia = {};
  vendido.forEach(v => porDia[v.fecha] = (porDia[v.fecha]||0) + v.total);
  const labels = Object.keys(porDia).sort();
  const data = labels.map(d => porDia[d]);
  const total = vendido.reduce((s,v) => s+v.total, 0);
  const costoTotal = vendido.reduce((s,v) => s+costoVenta(v), 0);
  const ganancia = total - costoTotal;
  const totalCobrado = cobrado.reduce((s,v)=>s+v.total,0);
  // CRITICO: "Ganancia bruta" de arriba es devengado (vendido) — a proposito NO incluye pagos
  // de fiado, para no duplicar el ingreso (la venta ya se conto el dia que se creo el fiado).
  // Pero eso dejaba la ganancia REAL de cobrar un fiado invisible en todo este reporte, aunque
  // el Dashboard si la mostrara — costoVenta() ya sabe leer el costoAsociado de un pago.
  const costoCobrado = cobrado.reduce((s,v) => s+costoVenta(v), 0);
  const gananciaCobrada = totalCobrado - costoCobrado;

  if (chartReporte) chartReporte.destroy();
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'line',
    data: { labels: labels.map(d => formatDate(d)), datasets: [
      { label: 'Ventas S/', data, borderColor: '#7C3AED', backgroundColor: 'rgba(124,58,237,0.1)', fill: true, tension: 0.4 },
      { label: 'Ganancia S/', data: labels.map(d => {
        const vs = vendido.filter(v=>v.fecha===d);
        const c = vs.reduce((s,v)=>s+costoVenta(v),0);
        return vs.reduce((s,v)=>s+v.total,0) - c;
      }), borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4 }
    ]},
    options: { plugins: { legend: { display: true, position: 'bottom' } }, responsive: true }
  });

  document.getElementById('rep-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Vendido (devengado)</div><div class="stat-value">${sol(total)}</div></div>
    <div class="stat-card blue" style="border-left-color:var(--info)"><div class="stat-label">Cobrado (caja real)</div><div class="stat-value">${sol(totalCobrado)}</div></div>
    <div class="stat-card green"><div class="stat-label">Ganancia bruta (devengado) S/</div><div class="stat-value">${sol(ganancia)}</div></div>
    <div class="stat-card green" style="border-left-color:var(--accent)"><div class="stat-label">Ganancia real cobrada S/ <span style="font-weight:400;font-size:.68rem;color:var(--gray-400)">(incluye pagos de fiado)</span></div><div class="stat-value">${sol(gananciaCobrada)}</div></div>
    <div class="stat-card"><div class="stat-label">N° transacciones</div><div class="stat-value">${vendido.length}</div></div>`;

  document.getElementById('rep-tabla-titulo').textContent = 'Ventas por día (devengado)';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Fecha</th><th>Transacc.</th><th>Total S/</th><th>Costo S/</th><th>Ganancia S/</th></tr></thead>
    <tbody>${labels.map(d => {
      const vs = vendido.filter(v=>v.fecha===d);
      const c = vs.reduce((s,v)=>s+costoVenta(v),0);
      const g = porDia[d]-c;
      return `<tr><td>${formatDate(d)}</td><td>${vs.length}</td><td>${sol(porDia[d])}</td><td style="color:var(--danger)">${sol(c)}</td><td style="color:var(--accent);font-weight:700">${sol(g)}</td></tr>`;
    }).join('')}
    </tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700"><td>TOTAL</td><td>${vendido.length}</td><td>${sol(total)}</td><td style="color:var(--danger)">${sol(costoTotal)}</td><td style="color:var(--accent)">${sol(ganancia)}</td></tr></tfoot>
    </table>`;
}

function reporteProductos(datos) {
  const { vendido } = datos;
  const prods = {};
  vendido.forEach(v => (v.items||[]).forEach(i => {
    if (!prods[i.nombre]) prods[i.nombre] = { cant: 0, total: 0, costo: 0 };
    prods[i.nombre].cant += i.cant;
    prods[i.nombre].total += subtotalItemCarrito(i);
    // Prioriza el costo historico guardado en el item — solo cae al costo actual del producto
    // si esa venta es anterior a este arreglo, y aun asi solo si el producto sigue existiendo.
    if (i.costoUnitario != null) {
      prods[i.nombre].costo += i.costoUnitario * i.cant;
    } else {
      const p = DB.productos.find(x=>x.id===i.prodId);
      prods[i.nombre].costo += (p?p.costo:0) * i.cant;
    }
  }));
  const sorted = Object.entries(prods).sort((a,b)=>b[1].cant-a[1].cant).slice(0,10);

  if (chartReporte) chartReporte.destroy();
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'bar',
    data: { labels: sorted.map(([n])=>n.length>15?n.substring(0,15)+'...':n), datasets: [{ label: 'Unidades vendidas', data: sorted.map(([,v])=>v.cant), backgroundColor: '#10B981', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, responsive: true, indexAxis: 'y' }
  });

  document.getElementById('rep-tabla-titulo').textContent = 'Top productos del período (vendido)';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Ingresos S/</th><th>Costo S/</th><th>Ganancia S/</th></tr></thead>
    <tbody>${sorted.map(([n,v])=>`<tr><td>${n}</td><td>${v.cant}</td><td>${sol(v.total)}</td><td style="color:var(--danger)">${sol(v.costo)}</td><td style="color:var(--accent);font-weight:700">${sol(v.total-v.costo)}</td></tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700"><td>TOTAL</td><td>${sorted.reduce((s,[,v])=>s+v.cant,0)}</td><td>${sol(sorted.reduce((s,[,v])=>s+v.total,0))}</td><td style="color:var(--danger)">${sol(sorted.reduce((s,[,v])=>s+v.costo,0))}</td><td style="color:var(--accent)">${sol(sorted.reduce((s,[,v])=>s+(v.total-v.costo),0))}</td></tr></tfoot>
    </table>`;
  document.getElementById('rep-stats').innerHTML = '';
}

function reporteRentabilidad(datos, desde, hasta) {
  const { vendido, cobrado } = datos;
  // Por producto — CRITICO: se agrupa por el prodId guardado en el ITEM, nunca por una
  // relectura del catalogo actual. Antes, si un producto se eliminaba del catalogo, la venta
  // completa desaparecia de este reporte (ni ingreso ni costo se contaban) — "Rentabilidad
  // real" y "Ganancia bruta" quedaban mal, en cualquier direccion segun el margen del producto
  // eliminado. El nombre y el costo tambien vienen del propio item (historico), nunca de una
  // relectura que pueda fallar si el producto ya no existe.
  const porProd = {};
  vendido.forEach(v => (v.items||[]).forEach(i => {
    const key = i.prodId;
    if (!porProd[key]) porProd[key] = { nombre: i.nombre, cantVendida: 0, ingresos: 0, costoTotal: 0 };
    porProd[key].cantVendida += i.cant;
    porProd[key].ingresos += subtotalItemCarrito(i);
    if (i.costoUnitario != null) {
      porProd[key].costoTotal += i.costoUnitario * i.cant;
    } else {
      const p = DB.productos.find(x=>x.id===i.prodId);
      porProd[key].costoTotal += (p ? p.costo : 0) * i.cant;
    }
  }));
  const data = Object.values(porProd).map(p => ({
    ...p,
    ganancia: p.ingresos - p.costoTotal,
    margenPct: p.costoTotal > 0 ? ((p.ingresos - p.costoTotal) / p.costoTotal * 100) : 0
  })).sort((a,b) => b.ganancia - a.ganancia);

  const totalIng = data.reduce((s,d)=>s+d.ingresos,0);
  const totalCosto = data.reduce((s,d)=>s+d.costoTotal,0);
  const totalGan = totalIng - totalCosto;
  const gastosMes = DB_EXT.gastos.filter(g=>g.fecha&&g.fecha>=desde&&g.fecha<=hasta).reduce((s,g)=>s+g.monto,0);
  const gastosRec = DB_EXT.gastosRec.reduce((s,g)=>s+g.monto,0);
  const sueldos = Object.values(DB_EXT.sueldos).reduce((s,v)=>s+v,0);
  const mermasCosto = DB.mermas.filter(m=>m.fecha>=desde&&m.fecha<=hasta).reduce((s,m)=>s+costoMerma(m),0);
  // CRITICO: descuentos manuales y por canje de puntos (venta.descuento, ya combina ambos —
  // ver descuentoManual/descuentoCombo en pos.js) nunca se restaban de ningun lado en este
  // reporte. Los "ingresos" por producto de arriba usan el precio LISTA de cada item — el
  // dinero que realmente entro a caja es menor cuando hubo descuento, pero el costo del
  // producto es el mismo, asi que esa diferencia es perdida real que no se veia reflejada,
  // inflando la ganancia mostrada cada vez que hubo un descuento en el periodo.
  const totalDescuentos = vendido.reduce((s,v) => s + (v.descuento || 0), 0);
  const rentReal = totalGan - gastosMes - gastosRec - sueldos - mermasCosto - totalDescuentos;
  const totalCobrado = cobrado.reduce((s,v)=>s+v.total,0);

  if (chartReporte) chartReporte.destroy();
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'bar',
    data: { labels: data.slice(0,8).map(d=>d.nombre.length>12?d.nombre.substring(0,12)+'...':d.nombre),
      datasets: [
        { label: 'Ganancia S/', data: data.slice(0,8).map(d=>d.ganancia.toFixed(2)), backgroundColor: '#10B981', borderRadius: 6 },
        { label: 'Costo S/', data: data.slice(0,8).map(d=>d.costoTotal.toFixed(2)), backgroundColor: '#EF4444', borderRadius: 6 }
      ]},
    options: { plugins: { legend: { display: true, position: 'bottom' } }, responsive: true }
  });

  document.getElementById('rep-stats').innerHTML = `
    <div class="stat-card green"><div class="stat-label">Ganancia bruta S/</div><div class="stat-value">${sol(totalGan)}</div></div>
    <div class="stat-card red"><div class="stat-label">Total gastos S/</div><div class="stat-value">${sol(gastosMes+gastosRec+sueldos+mermasCosto)}</div></div>
    <div class="stat-card ${rentReal>=0?'':'red'}"><div class="stat-label">Rentabilidad real S/</div><div class="stat-value" style="color:${rentReal>=0?'var(--accent)':'var(--danger)'}">${sol(rentReal)}</div></div>
    <div class="stat-card orange"><div class="stat-label">Pérdida mermas S/</div><div class="stat-value">${sol(mermasCosto)}</div></div>
    <div class="stat-card orange"><div class="stat-label">Descuentos aplicados S/ <span style="font-weight:400;font-size:.68rem">(manuales + canjes)</span></div><div class="stat-value">${sol(totalDescuentos)}</div></div>
    <div class="stat-card blue" style="border-left-color:var(--info)"><div class="stat-label">Cobrado en efectivo S/</div><div class="stat-value">${sol(totalCobrado)}</div></div>`;

  document.getElementById('rep-tabla-titulo').textContent = 'Rentabilidad por producto (vendido)';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Ingresos S/</th><th>Costo S/</th><th>Ganancia S/</th><th>Margen%</th></tr></thead>
    <tbody>${data.map(d=>`<tr>
      <td>${d.nombre}</td><td>${d.cantVendida}</td>
      <td>${sol(d.ingresos)}</td>
      <td style="color:var(--danger)">${sol(d.costoTotal)}</td>
      <td style="color:var(--accent);font-weight:700">${sol(d.ganancia)}</td>
      <td style="color:${d.margenPct>=20?'var(--accent)':d.margenPct>=10?'var(--warning)':'var(--danger)'};font-weight:700">${d.margenPct.toFixed(1)}%</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700">
      <td>TOTAL</td><td></td>
      <td>${sol(totalIng)}</td>
      <td style="color:var(--danger)">${sol(totalCosto)}</td>
      <td style="color:var(--accent)">${sol(totalGan)}</td><td></td>
    </tr></tfoot>
    </table>`;
}

function reporteMermas(desde, hasta, sede) {
  const mermas = DB.mermas.filter(m => m.fecha >= desde && m.fecha <= hasta && (!sede || (m.sedeId||'principal') === sede));
  const total = mermas.reduce((s,m)=>s+costoMerma(m),0);
  document.getElementById('rep-stats').innerHTML = `
    <div class="stat-card red"><div class="stat-label">Pérdida total período</div><div class="stat-value">${sol(total)}</div></div>
    <div class="stat-card orange"><div class="stat-label">N° registros</div><div class="stat-value">${mermas.length}</div></div>`;
  document.getElementById('rep-tabla-titulo').textContent = 'Detalle de mermas';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Motivo</th><th>Pérdida S/</th></tr></thead>
    <tbody>${mermas.map(m=>{const p=DB.productos.find(x=>x.id===m.prodId);return`<tr><td>${formatDate(m.fecha)}</td><td>${p?p.nombre:(m.nombre||'(producto eliminado)')}</td><td>${m.cant}</td><td>${m.motivo}</td><td style="color:var(--danger);font-weight:700">${sol(costoMerma(m))}</td></tr>`;}).join('')}</tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700"><td colspan="4">TOTAL PÉRDIDA</td><td style="color:var(--danger)">${sol(total)}</td></tr></tfoot>
    </table>`;
  if (chartReporte) chartReporte.destroy();
  // Chart por motivo
  const porMotivo = {};
  mermas.forEach(m => { porMotivo[m.motivo]=(porMotivo[m.motivo]||0)+costoMerma(m); });
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'doughnut',
    data: { labels: Object.keys(porMotivo), datasets: [{ data: Object.values(porMotivo), backgroundColor: ['#EF4444','#F59E0B','#7C3AED','#3B82F6','#10B981'] }] },
    options: { plugins: { legend: { position: 'bottom' } }, responsive: true }
  });
}

function reporteFiados(sede) {
  // Agrupar fiados por clienteId una sola vez (O(m)) en vez de filtrar el array completo por
  // cada cliente (O(n×m)) — mismo resultado, mejor escala si el negocio crece mucho.
  const fiadosPorCliente = new Map();
  DB.fiados.forEach(f => {
    if (sede && (f.sedeId||'principal') !== sede) return;
    const arr = fiadosPorCliente.get(f.clienteId);
    if (arr) arr.push(f); else fiadosPorCliente.set(f.clienteId, [f]);
  });
 const data = DB.clientes.map(c => {
    const fiadosCli = fiadosPorCliente.get(c.id) || [];
    const deudaReal = Math.round(fiadosCli.reduce((s,f) => s + fiadoMontoPendiente(f), 0) * 100) / 100;
    return { nombre: c.alias||c.nombre, deuda: deudaReal };
  }).filter(d => d.deuda > 0).sort((a,b) => b.deuda - a.deuda);
  const total = data.reduce((s,d)=>s+d.deuda,0);
  if (chartReporte) chartReporte.destroy();
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'bar',
    data: { labels: data.map(d=>d.nombre), datasets: [{ label: 'Deuda S/', data: data.map(d=>d.deuda), backgroundColor: '#EF4444', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, responsive: true }
  });
  document.getElementById('rep-stats').innerHTML = `
    <div class="stat-card red"><div class="stat-label">Total fiados S/</div><div class="stat-value">${sol(total)}</div></div>
    <div class="stat-card orange"><div class="stat-label">Clientes con deuda</div><div class="stat-value">${data.length}</div></div>`;
  document.getElementById('rep-tabla-titulo').textContent = 'Fiados pendientes';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Cliente</th><th>Deuda S/</th></tr></thead>
    <tbody>${data.map(d=>`<tr><td>${escapeHtml(d.nombre)}</td><td style="color:var(--danger);font-weight:700">${sol(d.deuda)}</td></tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700"><td>TOTAL</td><td style="color:var(--danger)">${sol(total)}</td></tr></tfoot>
    </table>`;
}

function reporteGastos(desde, hasta, sede) {
  const gastos = DB_EXT.gastos.filter(g=>g.fecha&&g.fecha>=desde&&g.fecha<=hasta&&(!sede||(g.sedeId||'principal')===sede));
  const total = gastos.reduce((s,g)=>s+g.monto,0);
  const porTipo = {};
  gastos.forEach(g => porTipo[g.tipo] = (porTipo[g.tipo]||0)+g.monto);
  if (chartReporte) chartReporte.destroy();
  chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
    type: 'doughnut',
    data: { labels: Object.keys(porTipo), datasets: [{ data: Object.values(porTipo), backgroundColor: ['#7C3AED','#EF4444','#F59E0B','#10B981','#3B82F6','#EC4899'] }] },
    options: { plugins: { legend: { position: 'bottom' } }, responsive: true }
  });
  document.getElementById('rep-stats').innerHTML = `<div class="stat-card red"><div class="stat-label">Total gastos S/</div><div class="stat-value">${sol(total)}</div></div>`;
  document.getElementById('rep-tabla-titulo').textContent = 'Gastos del período';
  document.getElementById('rep-tabla-wrap').innerHTML = `
    <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Monto S/</th></tr></thead>
    <tbody>${gastos.map(g=>`<tr><td>${formatDate(g.fecha)}</td><td><span class="badge badge-orange">${g.tipo}</span></td><td>${g.desc}</td><td style="font-weight:700;color:var(--danger)">${sol(g.monto)}</td></tr>`).join('')}</tbody>
    <tfoot><tr style="background:var(--gray-50);font-weight:700"><td colspan="3">TOTAL</td><td style="color:var(--danger)">${sol(total)}</td></tr></tfoot>
    </table>`;
}

// ── Reporte de Fidelización: costo real del programa en el período, no solo el historial suelto.
// canjes vive únicamente en Firestore (colección propia) — se trae ahí, no de un array local.
function reporteFidelizacion(desde, hasta, sede) {
  document.getElementById('rep-stats').innerHTML = '⏳ Cargando...';
  document.getElementById('rep-tabla-wrap').innerHTML = '';
  if (!dbModular) { document.getElementById('rep-stats').innerHTML = 'Sin conexión.'; return; } // [SDK modular]
  getDocsM(queryM(collectionM(dbModular, 'canjes'), whereM('fecha', '>=', desde), whereM('fecha', '<=', hasta))).then(snap => {
    let canjes = snap.docs.map(d => d.data());
    if (sede) canjes = canjes.filter(c => (c.sedeId||'principal') === sede);

    const totalCanjes = canjes.length;
    const puntosCanjeados = canjes.reduce((s,c) => s + (c.puntosUsados||0), 0);
    const costoProductos = canjes.filter(c=>c.tipo==='producto').reduce((s,c) => s + (c.costoAsociado||0), 0);
    const costoDescuentos = canjes.filter(c=>c.tipo==='descuento').reduce((s,c) => s + (c.montoDescuento||0), 0);
    const costoTotal = Math.round((costoProductos + costoDescuentos) * 100) / 100;

    // Contexto: cuánto representa este costo sobre lo vendido en el mismo período — la pregunta
    // real de negocio ("¿el programa se está comiendo el margen?"), no solo un número suelto.
    const ventasPeriodo = (DB.historialVentas||[]).filter(v => v.fecha>=desde && v.fecha<=hasta && v.estado!=='fiado' && (!sede || (v.sedeId||'principal')===sede)).reduce((s,v)=>s+(v.total||0),0);
    const pctSobreVentas = ventasPeriodo > 0 ? (costoTotal / ventasPeriodo * 100) : 0;

    if (chartReporte) chartReporte.destroy();
    chartReporte = new Chart(document.getElementById('chart-reporte').getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Productos canjeados', 'Descuentos aplicados'], datasets: [{ data: [costoProductos, costoDescuentos], backgroundColor: ['#7C3AED','#F59E0B'] }] },
      options: { plugins: { legend: { position: 'bottom' } }, responsive: true }
    });

    document.getElementById('rep-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Canjes realizados</div><div class="stat-value">${totalCanjes}</div></div>
      <div class="stat-card orange"><div class="stat-label">Puntos canjeados</div><div class="stat-value">${puntosCanjeados}</div></div>
      <div class="stat-card red"><div class="stat-label">Costo total S/</div><div class="stat-value">${sol(costoTotal)}</div></div>
      <div class="stat-card ${pctSobreVentas > 3 ? 'red' : 'green'}"><div class="stat-label">% sobre ventas del período</div><div class="stat-value">${pctSobreVentas.toFixed(2)}%</div></div>`;
    document.getElementById('rep-tabla-titulo').textContent = 'Canjes del período';
    document.getElementById('rep-tabla-wrap').innerHTML = `
      <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Premio</th><th>Tipo</th><th>Puntos</th><th>Costo S/</th></tr></thead>
      <tbody>${canjes.map(c=>`<tr><td>${formatDate(c.fecha)}</td><td>${getClienteNombre(c.clienteId)}</td><td>${c.premioNombre}</td><td>${c.tipo==='producto'?'📦 Producto':'💰 Descuento'}</td><td>${c.puntosUsados}</td><td style="font-weight:700;color:var(--danger)">${sol((c.costoAsociado||0)+(c.montoDescuento||0))}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400)">Sin canjes en este período</td></tr>'}</tbody>
      <tfoot><tr style="background:var(--gray-50);font-weight:700"><td colspan="5">TOTAL</td><td style="color:var(--danger)">${sol(costoTotal)}</td></tr></tfoot>
      </table>`;
  }).catch(e => {
    document.getElementById('rep-stats').innerHTML = 'Error cargando canjes.';
    console.warn('reporteFidelizacion:', e);
  });
}
async function exportReporte() {
  const desde = document.getElementById('rep-desde').value || '2000-01-01';
  const hasta  = document.getElementById('rep-hasta').value  || '2099-12-31';
  const sede   = document.getElementById('rep-sede')?.value  || '';
  const diasRango = Math.round((new Date(hasta) - new Date(desde)) / 86400000);
  if (diasRango > 30) {
    if (!confirm(`El rango elegido es de ${diasRango} días — trae más datos de lo normal (más tráfico/lecturas). ¿Continuar?`)) return;
  }
  const xe = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const cs = v => `<Cell><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  const cn = v => `<Cell><Data ss:Type="Number">${isNaN(parseFloat(v))?0:parseFloat(v).toFixed(2)}</Data></Cell>`;
  const ch = v => `<Cell ss:StyleID="h"><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  const xr = (...c) => `<Row>${c.join('')}</Row>`;
  const ws = (name, rows) => `<Worksheet ss:Name="${xe(name)}"><Table>${rows.join('')}</Table></Worksheet>`;

  // Filtro común de ventas — vendido (devengado), consistente con Historial/Reportes en pantalla
  let vf;
  try {
    const datos = await _cargarVentasReporte(desde, hasta, sede);
    vf = datos.vendido;
  } catch (e) {
    alert('⚠️ No se pudo exportar. Intenta de nuevo.');
    return;
  }

  // Hoja 1: Ventas por día
  const porDia = {};
  vf.forEach(v => {
    if (!porDia[v.fecha]) porDia[v.fecha] = {tx:0, tot:0, cos:0};
    porDia[v.fecha].tx++;
    porDia[v.fecha].tot += v.total;
    porDia[v.fecha].cos += costoVenta(v);
  });
  const r1 = [xr(ch('Fecha'),ch('Transacciones'),ch('Total S/'),ch('Costo S/'),ch('Ganancia S/'))];
  Object.keys(porDia).sort().forEach(d => {
    const dd=porDia[d]; r1.push(xr(cs(formatDate(d)),cn(dd.tx),cn(dd.tot),cn(dd.cos),cn(dd.tot-dd.cos)));
  });
  const vTot=vf.reduce((s,v)=>s+v.total,0), vCos=Object.values(porDia).reduce((s,d)=>s+d.cos,0);
  r1.push(xr(cs('TOTAL'),cn(vf.length),cn(vTot),cn(vCos),cn(vTot-vCos)));

  // Hoja 2: Productos
  const prods = {};
  vf.forEach(v=>(v.items||[]).forEach(i=>{
    if(!prods[i.nombre])prods[i.nombre]={cant:0,tot:0,cos:0};
    prods[i.nombre].cant+=i.cant; prods[i.nombre].tot+=subtotalItemCarrito(i);
    const p=DB.productos.find(x=>x.id===i.prodId); prods[i.nombre].cos+=(p?p.costo:0)*i.cant;
  }));
  const r2=[xr(ch('Producto'),ch('Cantidad'),ch('Ingresos S/'),ch('Costo S/'),ch('Ganancia S/'))];
  Object.entries(prods).sort((a,b)=>b[1].cant-a[1].cant).forEach(([n,v])=>r2.push(xr(cs(n),cn(v.cant),cn(v.tot),cn(v.cos),cn(v.tot-v.cos))));
  const pTot=Object.values(prods).reduce((s,v)=>s+v.tot,0),pCos=Object.values(prods).reduce((s,v)=>s+v.cos,0);
  r2.push(xr(cs('TOTAL'),cn(Object.values(prods).reduce((s,v)=>s+v.cant,0)),cn(pTot),cn(pCos),cn(pTot-pCos)));

  // Hoja 3: Rentabilidad
  const porP={};
  vf.forEach(v=>(v.items||[]).forEach(i=>{
    const p=DB.productos.find(x=>x.id===i.prodId); if(!p) return;
    if(!porP[p.id])porP[p.id]={nom:p.nombre,cant:0,ing:0,cos:0};
    porP[p.id].cant+=i.cant; porP[p.id].ing+=subtotalItemCarrito(i); porP[p.id].cos+=p.costo*i.cant;
  }));
  const r3=[xr(ch('Producto'),ch('Cantidad'),ch('Ingresos S/'),ch('Costo S/'),ch('Ganancia S/'),ch('Margen%'))];
  Object.values(porP).sort((a,b)=>(b.ing-b.cos)-(a.ing-a.cos)).forEach(d=>{
    const g=d.ing-d.cos, m=d.cos>0?g/d.cos*100:0;
    r3.push(xr(cs(d.nom),cn(d.cant),cn(d.ing),cn(d.cos),cn(g),cn(m.toFixed(1))));
  });
  const gB=Object.values(porP).reduce((s,d)=>s+d.ing-d.cos,0);
  const gOp=DB_EXT.gastos.filter(g=>g.fecha&&g.fecha>=desde&&g.fecha<=hasta).reduce((s,g)=>s+g.monto,0);
  const gRec=DB_EXT.gastosRec.reduce((s,g)=>s+g.monto,0);
  const sue=Object.values(DB_EXT.sueldos).reduce((s,v)=>s+v,0);
  const mer=DB.mermas.filter(m=>m.fecha>=desde&&m.fecha<=hasta).reduce((s,m)=>s+costoMerma(m),0);
  r3.push(xr(cs(''),cs(''),cs(''),cs(''),cs(''),cs('')));
  r3.push(xr(cs('Ganancia bruta'),cs(''),cs(''),cs(''),cn(gB),cs('')));
  r3.push(xr(cs('Gastos operativos'),cs(''),cs(''),cs(''),cn(-(gOp+gRec+sue)),cs('')));
  r3.push(xr(cs('Pérdida mermas'),cs(''),cs(''),cs(''),cn(-mer),cs('')));
  r3.push(xr(cs('RENTABILIDAD REAL'),cs(''),cs(''),cs(''),cn(gB-gOp-gRec-sue-mer),cs('')));

  // Hoja 4: Mermas
  const merLst=DB.mermas.filter(m=>m.fecha>=desde&&m.fecha<=hasta);
  const r4=[xr(ch('Fecha'),ch('Producto'),ch('Cantidad'),ch('Motivo'),ch('Pérdida S/'))];
  merLst.forEach(m=>{const p=DB.productos.find(x=>x.id===m.prodId);r4.push(xr(cs(formatDate(m.fecha)),cs(p?p.nombre:(m.nombre||'(producto eliminado)')),cn(m.cant),cs(m.motivo),cn(costoMerma(m))));});
  r4.push(xr(cs('TOTAL PÉRDIDA'),cs(''),cs(''),cs(''),cn(merLst.reduce((s,m)=>s+costoMerma(m),0))));

  // Hoja 5: Fiados
  const fLst=DB.clientes.map(c=>({nom:c.alias||c.nombre,deu:DB.fiados.filter(f=>f.clienteId===c.id).reduce((s,f)=>s+fiadoMontoPendiente(f),0)})).filter(d=>d.deu>0).sort((a,b)=>b.deu-a.deu);
  const r5=[xr(ch('Cliente'),ch('Deuda S/'))];
  fLst.forEach(d=>r5.push(xr(cs(d.nom),cn(d.deu))));
  r5.push(xr(cs('TOTAL'),cn(fLst.reduce((s,d)=>s+d.deu,0))));

  // Hoja 6: Gastos
  const gLst=DB_EXT.gastos.filter(g=>g.fecha&&g.fecha>=desde&&g.fecha<=hasta);
  const r6=[xr(ch('Fecha'),ch('Tipo'),ch('Descripción'),ch('Monto S/'))];
  gLst.forEach(g=>r6.push(xr(cs(formatDate(g.fecha)),cs(g.tipo),cs(g.desc),cn(g.monto))));
  r6.push(xr(cs('TOTAL'),cs(''),cs(''),cn(gLst.reduce((s,g)=>s+g.monto,0))));

  // Generar Workbook SpreadsheetML
  const wb = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EDE9FE" ss:Pattern="Solid"/></Style></Styles>${ws('Ventas',r1)}${ws('Productos',r2)}${ws('Rentabilidad',r3)}${ws('Mermas',r4)}${ws('Fiados',r5)}${ws('Gastos',r6)}</Workbook>`;

  const blob = new Blob([wb], {type:'application/vnd.ms-excel;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `reporte-aleze-${desde}-${hasta}.xls`; a.click();
  URL.revokeObjectURL(url);
}
// ===================== HISTORIAL DE VENTAS =====================
// ── Fase 2: consulta a ventas/{id} por rango de fecha (colección nueva, sin listener — Sección 9) ──
async function _fetchVentasRango(desde, hasta) {
  if (!dbModular) return []; // [SDK modular]
  const snap = await getDocsM(queryM(collectionM(dbModular, 'ventas'), whereM('fecha', '>=', desde), whereM('fecha', '<=', hasta)));
  return snap.docs.map(d => d.data());
}
// ── Fase 4: consulta a movimientos/{id} — solo se usa si el filtro de Caja pide más de 30 días ──
async function _fetchMovimientosRango(desde, hasta) {
  if (!dbModular) return []; // [SDK modular]
  const snap = await getDocsM(queryM(collectionM(dbModular, 'movimientos'), whereM('fecha', '>=', desde), whereM('fecha', '<=', hasta)));
  return snap.docs.map(d => d.data());
}

// ── Rango por defecto + advertencia si es amplio — compartido entre Historial y Reportes ──
// Devuelve null si el usuario cancela la advertencia (el llamador debe abortar sin consultar).
function _resolverRangoConAviso(desdeInput, hastaInput, diasDefault) {
  let desde = desdeInput, hasta = hastaInput;
  if (!desde && !hasta) {
    const d = new Date(); d.setDate(d.getDate() - diasDefault);
    desde = d.toISOString().split('T')[0];
    hasta = today();
  } else {
    if (!desde) desde = '2000-01-01';
    if (!hasta) hasta = today();
  }
  const diasRango = Math.round((new Date(hasta) - new Date(desde)) / 86400000);
  if (diasRango > 30) {
    if (!confirm(`El rango elegido es de ${diasRango} días — trae más datos de lo normal (más tráfico/lecturas). ¿Continuar?`)) return null;
  }
  return { desde, hasta };
}

async function renderHistorialVentas() {
  const inDesde = document.getElementById('hv-desde');
  const inHasta = document.getElementById('hv-hasta');
  const inEstado = document.getElementById('hv-estado');
  const inOrigen = document.getElementById('hv-origen');
  const inSede   = document.getElementById('hv-sede');
  const inBuscar = document.getElementById('hv-buscar');
  const estado = inEstado?.value || '';
  const origen = inOrigen?.value || '';
  const buscar = (inBuscar?.value || '').toLowerCase();

  // CRITICO — fuga real de datos entre sedes, confirmada: antes, un vendedor podia ver ventas
  // de la OTRA sede simplemente dejando este filtro en "Todas las sedes" (el valor por defecto
  // del <select>) — no habia nada que se lo impidiera. Vendedor (no-admin) NUNCA puede elegir
  // "todas" — se le oculta el selector y se fuerza su propia sede sin importar que diga el DOM,
  // como defensa en profundidad ante quien intente forzar el valor desde las herramientas de
  // desarrollador. Admin si puede ver "todas las sedes" a proposito (reportes consolidados),
  // pero el selector arranca en SU sede activa, no en "todas", cada vez que entra a la pagina.
  const _esAdmin = currentRole === 'admin';
  if (inSede) inSede.style.display = _esAdmin ? '' : 'none';
  const _labelSede = inSede ? inSede.previousElementSibling : null; // por si hay un <label> asociado
  let sede;
  if (_esAdmin) {
    sede = inSede?.value || '';
  } else {
    sede = sedeAdminEfectiva();
    if (inSede) inSede.value = sede; // mantiene el DOM consistente aunque este oculto
  }

  const rango = _resolverRangoConAviso(inDesde?.value || '', inHasta?.value || '', 7);
  if (!rango) return; // advertencia de rango amplio cancelada por el usuario
  if (inDesde) inDesde.value = rango.desde;
  if (inHasta) inHasta.value = rango.hasta;

  const tbody = document.getElementById('hv-tbody');
  const controles = [inDesde, inHasta, inEstado, inOrigen, inSede, inBuscar];
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1.5rem;color:var(--gray-400)">⏳ Cargando...</td></tr>';
  controles.forEach(el => { if (el) el.disabled = true; });

  let lista;
  try {
    lista = await _fetchVentasRango(rango.desde, rango.hasta);
  } catch (e) {
    console.warn('renderHistorialVentas: error consultando ventas/{id}', e);
    controles.forEach(el => { if (el) el.disabled = false; });
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1.5rem;color:var(--danger)">⚠️ Error cargando historial. Intenta de nuevo.</td></tr>';
    return;
  }
  controles.forEach(el => { if (el) el.disabled = false; });

  if (sede)   lista = lista.filter(v => (v.sedeId||'principal') === sede);
  if (estado) lista = lista.filter(v => v.estado === estado);
  if (origen) lista = lista.filter(v => v.origen === origen);
  if (buscar) lista = lista.filter(v =>
_norm(v.cajero||'').includes(_norm(buscar)) ||
_norm(v.clienteNombre||getClienteNombre(v.clienteId)||'').includes(_norm(buscar)) ||
(v.items||[]).some(i => _norm(i.nombre||'').includes(_norm(buscar)))
  );
  lista.sort((a,b) => (b.id || 0) > (a.id || 0) ? 1 : -1);

  // Vendido (devengado): toda venta al momento de venderse, fiado incluido — excluye el registro de PAGO (ya se contó al vender)
  const vendido = lista.filter(v => v.origen !== 'pago_fiado').reduce((s,v) => s+(v.total||0), 0);
  // Cobrado (caja real): mismo filtro que ya usa Dashboard — solo plata que efectivamente entró
  const cobrado = lista.filter(v => (v.origen==='pos'&&v.estado==='completado')||(v.origen==='online'&&v.estado==='completado')||(v.origen==='pago_fiado'&&v.estado==='completado')).reduce((s,v) => s+(v.total||0), 0);
  // Fiado pendiente: saldo real contra DB.fiados (no el total original — puede ya estar parcial o totalmente pagado)
  const fiadoPendiente = lista.filter(v => v.estado === 'fiado').reduce((s,v) => {
    const f = DB.fiados.find(x => x.id === v.id);
    const pendiente = f ? Math.max(0, (f.total||0) - (f.pagado||0)) : (v.total||0);
    return s + pendiente;
  }, 0);
  const completadas = lista.filter(v=>v.estado==='completado').length;
  const parciales = lista.filter(v=>v.estado==='parcial').length;
  const anuladas = lista.filter(v=>v.estado==='anulado').length;

  const statsEl = document.getElementById('hv-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card green"><div class="stat-label">Vendido</div><div class="stat-value">${sol(vendido)}</div></div>
    <div class="stat-card blue"><div class="stat-label">Cobrado</div><div class="stat-value">${sol(cobrado)}</div></div>
    <div class="stat-card orange"><div class="stat-label">Fiado pendiente</div><div class="stat-value">${sol(fiadoPendiente)}</div></div>
    <div class="stat-card"><div class="stat-label">Completadas</div><div class="stat-value">${completadas}</div></div>
    <div class="stat-card orange"><div class="stat-label">Parciales</div><div class="stat-value">${parciales}</div></div>
    <div class="stat-card red"><div class="stat-label">Anuladas</div><div class="stat-value">${anuladas}</div></div>`;

  const badgeColor = { completado:'badge-green', parcial:'badge-orange', anulado:'badge-red' };
  const origenIcon = { pos:'🏪', online:'🌐' };

  if (!tbody) return;
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:1.5rem;color:var(--gray-400)">Sin ventas en el período seleccionado</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(v => {
    const nombre = v.clienteNombre || (v.clienteId ? getClienteNombre(v.clienteId) : v.cajero);
    const prods  = (v.items||[]).map(i=>`${escapeHtml(i.nombre)} x${i.cantReal??i.cant}`).join(', ');
    const totalDevuelto = (v.devoluciones||[]).reduce((s,d)=>s+d.monto,0);
    const tieneDevolucion = totalDevuelto > 0;
    const btnLabel = v.estado === 'anulado' ? '👁️ Ver' : '↩️ Devolver';
    const btnDisabled = v.estado === 'anulado' ? 'disabled style="opacity:.5;cursor:not-allowed"' : '';
    return `<tr ${v.estado==='anulado'?'style="opacity:.6"':''}>
      <td>${formatDate(v.fecha)}</td>
      <td>${v.hora||'-'}</td>
      <td>${origenIcon[v.origen]||'🏪'} ${v.origen==='online'?'Online':'POS'}</td>
      <td>${escapeHtml(nombre)||'-'}</td>
      <td style="font-size:.78rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${prods}">${prods}</td>
      <td style="font-weight:700">
        ${sol(v.total)}
        ${tieneDevolucion ? `<div style="font-size:.7rem;color:var(--danger)">-${sol(totalDevuelto)} dev.</div>` : ''}
      </td>
      <td><span class="badge badge-blue">${v.metodo||'-'}</span></td>
      <td>
        <span class="badge ${badgeColor[v.estado]||'badge-gray'}">${v.estado||'completado'}</span>
        ${tieneDevolucion && v.estado!=='anulado' ? '<span class="badge badge-orange" style="margin-left:2px">parcial</span>' : ''}
      </td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-xs" onclick="abrirActualizarVenta('${v.id}')" ${btnDisabled}>${btnLabel}</button>
        ${v.estado!=='anulado' ? `<button class="btn btn-outline btn-xs" onclick="corregirMetodoPago('${v.id}')" title="Corregir método de pago">✏️ Método</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function exportHistorialVentas() {
  const desde = document.getElementById('hv-desde')?.value || '';
  const hasta = document.getElementById('hv-hasta')?.value || '';
  const sede  = document.getElementById('hv-sede')?.value   || '';
  const rango = _resolverRangoConAviso(desde, hasta, 7);
  if (!rango) return;
  let lista;
  try {
    lista = await _fetchVentasRango(rango.desde, rango.hasta);
  } catch (e) {
    alert('⚠️ No se pudo exportar. Intenta de nuevo.');
    return;
  }
  if (sede) lista = lista.filter(v => (v.sedeId||'principal') === sede);
  if (lista.length === 0) { alert('Sin datos en ese rango'); return; }
  let csv = 'Fecha,Hora,Sede,Origen,Cajero/Cliente,Productos,Total,Método,Estado\n';
  lista.forEach(v => {
    const nombre = v.clienteNombre||(v.clienteId?getClienteNombre(v.clienteId):v.cajero);
    const prods = (v.items||[]).map(i=>`${i.nombre}x${i.cant}`).join('|');
    csv += `"${v.fecha}","${v.hora||''}","${v.sedeId||'principal'}","${v.origen||'pos'}","${nombre||''}","${prods}","${v.total}","${v.metodo||''}","${v.estado||'completado'}"\n`;
  });
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'historial-ventas.csv'; a.click();
}

let _hvEditId  = null;
let _huvTab    = 'parcial'; // 'parcial' | 'anular'
let _huvVenta  = null;      // copia de la venta en edición

function huvSetTab(tab) {
  _huvTab = tab;
  const esParcial = tab === 'parcial';
  document.getElementById('huv-panel-parcial').style.display = esParcial ? '' : 'none';
  document.getElementById('huv-panel-anular').style.display  = esParcial ? 'none' : '';
  document.getElementById('huv-tab-parcial').style.background = esParcial ? 'var(--primary)' : 'white';
  document.getElementById('huv-tab-parcial').style.color      = esParcial ? 'white' : 'var(--gray-600)';
  document.getElementById('huv-tab-anular').style.background  = esParcial ? 'white' : 'var(--danger)';
  document.getElementById('huv-tab-anular').style.color       = esParcial ? 'var(--gray-600)' : 'white';
  const btn = document.getElementById('huv-btn-guardar');
  if (btn) {
    btn.textContent = esParcial ? '↩️ Confirmar devolución parcial' : '❌ Anular venta completa';
    btn.className   = esParcial ? 'btn btn-danger' : 'btn btn-danger';
  }
}

// ── Corrección rápida de método de pago (Fase 4) — sin devolución completa, mismo candado de 15 días ──
async function corregirMetodoPago(id) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede corregir el método de pago.'); return; }
  const todos = [...(DB.historialVentas||[]), ...(DB.ventas||[])];
  const v = todos.find(x => String(x.id) === String(id));
  if (!v) { alert('Venta no encontrada localmente (puede haber salido de la ventana de 30 días de historialVentas).'); return; }
  if (v.estado === 'anulado') { alert('Esta venta ya fue anulada.'); return; }
  const diasTranscurridos = -diasHasta(v.fecha);
  if (diasTranscurridos > 15) { alert('⛔ Esta venta tiene ' + Math.floor(diasTranscurridos) + ' días — ya no se puede corregir el método (máximo 15).'); return; }
  const metodoViejo = v.metodo || 'Efectivo';
  const _metodosPago = ['Efectivo','Yape','Plin','QR','Link de pago','Tarjeta POS','Tarjeta POS Móvil','Transferencia'];
  const idx = parseInt(prompt(`Método actual: ${metodoViejo}\n\nElige el correcto:\n` + _metodosPago.map((m,i)=>`${i+1}. ${m}`).join('\n')));
  if (!idx || idx < 1 || idx > _metodosPago.length) return;
  const metodoNuevo = _metodosPago[idx-1];
  if (metodoNuevo === metodoViejo) { alert('Es el mismo método, nada que corregir.'); return; }
  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]

  const sede = sedeAdminEfectiva();
  // CRITICO: runTransaction en vez de writeBatch — lee la venta real del servidor antes de
  // escribir, para no revivir una venta que otro proceso ya anulo/devolvio entre medio, y
  // solo toca el campo metodo (nunca el resto del documento con datos potencialmente viejos).
  const ventaRef = docM(dbModular, 'ventas', String(v.id));
  let _r;
  try {
    _r = await runTransactionM(dbModular, async (tx) => {
      const snap = await tx.get(ventaRef); // lectura garantizada real del servidor
      if (!snap.exists()) throw new Error('Esta venta ya no existe en el servidor.'); // en modular, exists es un METODO
      const vServidor = snap.data();
      if (vServidor.estado === 'anulado') {
        throw new Error('Esta venta ya fue anulada (por otro proceso) — no se puede corregir el método.');
      }
      const _corrigeCajaHoy = vServidor.fecha === today() && DB.caja.abierta && DB.caja.fecha === today();
      const eraEfectivo = metodoViejo === 'Efectivo', esEfectivo = metodoNuevo === 'Efectivo';
      let _deltaEfectivo = 0;
      if (_corrigeCajaHoy) {
        if (eraEfectivo && !esEfectivo) _deltaEfectivo = -vServidor.total;
        if (!eraEfectivo && esEfectivo) _deltaEfectivo = vServidor.total;
      }

      tx.set(ventaRef, { metodo: metodoNuevo }, { merge: true });
      if (_corrigeCajaHoy && _deltaEfectivo !== 0) {
        tx.set(docM(dbModular, 'caja', sede), { ingresosEfectivo: incrementM(_deltaEfectivo) }, { merge: true });
      }
      const _movId = getId();
      const _movData = { id:_movId, tipo:'info', desc:`Corrección método venta #${vServidor.id}: ${metodoViejo} → ${metodoNuevo}`, monto:0, hora:nowTime(), fecha:today(), cajero:currentUser, sedeId: sede };
      tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

      return { _corrigeCajaHoy, _deltaEfectivo, _movData };
    });
  } catch (e) {
    alert('⚠️ No se pudo corregir el método: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se refleja en memoria local.
  v.metodo = metodoNuevo;
  if (_r._corrigeCajaHoy && _r._deltaEfectivo !== 0) {
    DB.caja.ingresosEfectivo = Math.max(0, (DB.caja.ingresosEfectivo||0) + _r._deltaEfectivo);
  }
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_r._movData);
  fbGuardar();
  try { renderHistorialVentas(); } catch(e){}
  try { renderCaja(); } catch(e){}
  alert(`✅ Método corregido a ${metodoNuevo}.`);
}

function abrirActualizarVenta(id) {
  // Solo el admin puede hacer devoluciones
  if (currentRole !== 'admin') {
    alert('⛔ Solo el administrador puede registrar devoluciones.');
    return;
  }
  _hvEditId = id;
  _huvTab   = 'parcial';

  const todos = [...(DB.historialVentas||[]), ...(DB.ventas||[])];
  const v = todos.find(x => String(x.id) === String(id));
  if (!v) return;

  // Si ya fue anulada no permitir volver a modificar
  if (v.estado === 'anulado') {
    alert('Esta venta ya fue anulada y no puede modificarse.'); return;
  }

  // Política de negocio: devoluciones solo dentro de 15 días desde la venta
  const diasTranscurridos = -diasHasta(v.fecha);
  if (diasTranscurridos > 15) {
    alert('⛔ Esta venta tiene ' + Math.floor(diasTranscurridos) + ' días y ya no admite devolución por este flujo (máximo 15).\n\nSi corresponde un ajuste, regístralo directo como merma (producto) o gasto/movimiento de caja (dinero).');
    return;
  }

  _huvVenta = JSON.parse(JSON.stringify(v)); // copia de trabajo

  // Info resumen
  const itemsStr = (v.items||[]).map(i=>`${escapeHtml(i.nombre)} x${i.cantReal??i.cant}`).join(', ');
  document.getElementById('huv-info').innerHTML = `
    <div style="background:var(--gray-50);border-radius:8px;padding:.75rem 1rem;font-size:.82rem;margin-bottom:1rem;border:1px solid var(--gray-200)">
      <div style="font-weight:700;margin-bottom:.2rem">📋 Venta ${formatDate(v.fecha)} ${v.hora||''} — ${escapeHtml(v.cajero||v.clienteNombre||'-')}</div>
      <div style="color:var(--gray-600)">${itemsStr}</div>
      <div style="margin-top:.35rem">
        <strong style="color:var(--primary)">Total original cobrado: ${sol(v.total)}</strong>
        <span style="margin-left:1rem;color:var(--gray-500)">Método: ${v.metodo||'-'}</span>
        ${v.devoluciones?.length ? `<span style="margin-left:1rem;color:var(--danger);font-weight:700">Ya devuelto: ${sol(v.devoluciones.reduce((s,d)=>s+d.monto,0))}</span>` : ''}
      </div>
    </div>`;

  // Autorizado por
  document.getElementById('huv-autorizado').value = currentUser || 'Admin';

  // Limpiar obs y método
  document.getElementById('huv-obs').value = '';
  document.getElementById('huv-metodo-reembolso').value = v.metodo || 'Efectivo';

  // Panel anular: monto total
  document.getElementById('huv-anular-monto').textContent = `Reembolso total: ${sol(v.total)}`;

  // Renderizar items para devolución parcial
  _renderHuvItems(v);

  // Activar tab parcial por defecto
  huvSetTab('parcial');
  abrirModal('modal-actualizar-venta');
}

function _renderHuvItems(v) {
  const wrap = document.getElementById('huv-items-wrap');
  if (!wrap) return;
  // Usar cantReal si ya hubo ajuste previo, si no usar cant original
  wrap.innerHTML = (v.items||[]).map((item, i) => {
    const cantOrig = item.cantReal ?? item.cant;
    const yaDevuelto = (v.devoluciones||[]).reduce((s,d) => {
      const di = d.items?.find(x => x.prodId === item.prodId);
      return s + (di?.cantDevuelta||0);
    }, 0);
    const cantDisp = Math.max(0, cantOrig - yaDevuelto);
    return `
    <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .25rem;border-bottom:1px solid var(--gray-100)" id="huv-row-${i}">
      <span style="flex:1;font-size:.83rem;font-weight:600">${item.nombre}</span>
      <span style="font-size:.75rem;color:var(--gray-400)">vendido: <strong>${cantOrig}</strong></span>
      ${yaDevuelto > 0 ? `<span style="font-size:.72rem;color:var(--danger)">devuelto: ${yaDevuelto}</span>` : ''}
      <span style="font-size:.75rem;color:var(--gray-500)">devolver:</span>
      <input type="number" class="form-control" id="huv-dev-${i}"
        value="0" min="0" max="${cantDisp}" step="${item.tipo==='granel'?0.1:1}"
        style="width:75px;font-size:.85rem;text-align:center"
        oninput="huvRecalc()" ${cantDisp<=0?'disabled':''}/>
      <span style="font-size:.75rem;color:var(--primary);min-width:60px;text-align:right">
        ${sol(item.precio)} c/u
      </span>
    </div>`; }).join('');

  // Ocultar resumen al inicio
  document.getElementById('huv-devolucion-resumen').style.display = 'none';
}

function huvRecalc() {
  if (!_huvVenta) return;
  const items = _huvVenta.items || [];
  let montoDevuelto = 0;
  const detalle = [];

  items.forEach((item, i) => {
    const input = document.getElementById('huv-dev-' + i);
    if (!input) return;
    const cantDev = parseFloat(input.value) || 0;
    if (cantDev > 0) {
      const sub = cantDev * item.precio;
      montoDevuelto += sub;
      detalle.push(`${item.nombre} x${cantDev}`);
    }
  });

  const resumen = document.getElementById('huv-devolucion-resumen');
  if (montoDevuelto > 0) {
    resumen.style.display = '';
    document.getElementById('huv-dev-detalle').textContent = detalle.join(', ');
    document.getElementById('huv-dev-monto').textContent   = sol(montoDevuelto);
    const nuevoTotal = Math.max(0, _huvVenta.total - montoDevuelto);
    document.getElementById('huv-nuevo-total').textContent = sol(nuevoTotal);
  } else {
    resumen.style.display = 'none';
  }
}

async function guardarActualizarVenta() {
  if (!_hvEditId || !_huvVenta) return;
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede registrar devoluciones.'); return; }

  // Re-chequeo de política (por si el modal quedó abierto y cruzó la fecha límite)
  if (-diasHasta(_huvVenta.fecha) > 15) {
    alert('⛔ Esta venta ya superó los 15 días permitidos. Ciérrala y usa merma o gasto/movimiento de caja.');
    cerrarModal('modal-actualizar-venta');
    return;
  }

  const obs     = document.getElementById('huv-obs').value.trim();
  const metodo  = document.getElementById('huv-metodo-reembolso').value;
  const autoriza = document.getElementById('huv-autorizado').value || currentUser;

  if (!obs) { alert('Por favor ingresa el motivo de la devolución.'); return; }

  // ── Localizar la venta en DB ──────────────────────────────────────────────
  if (!DB.historialVentas) DB.historialVentas = [];
  let hvIdx = DB.historialVentas.findIndex(x => String(x.id) === String(_hvEditId));
  if (hvIdx < 0) {
    // Estaba solo en DB.ventas → mover al historial
    const vi = DB.ventas.findIndex(x => String(x.id) === String(_hvEditId));
    if (vi < 0) { cerrarModal('modal-actualizar-venta'); return; }
    DB.historialVentas.push({ ...DB.ventas[vi], origen:'pos', estado: DB.ventas[vi].estado || 'completado', estadoStock:'descontado' });
    hvIdx = DB.historialVentas.length - 1;
  }
  const vDB = DB.historialVentas[hvIdx];
  const ventaRef = docM(dbModular, 'ventas', String(vDB.id));

  // ══════════════════════════════════════════════════════════════════════════
  // CASO A: Anular venta completa
  // ══════════════════════════════════════════════════════════════════════════
  if (_huvTab === 'anular') {
    if (!confirm(`¿Confirmar ANULACIÓN TOTAL de esta venta?\n\nSe reembolsará ${sol(vDB.total)} al cliente y se restituirá todo el stock.\n\nEsta acción no se puede deshacer.`)) return;

    if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
    await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()
    const _sedeDev = vDB.sedeId || sedeAdminEfectiva();

    // CRITICO: runTransaction en vez de writeBatch — lee la venta real del servidor (con su
    // array de devoluciones ya acumuladas) antes de calcular cuanto stock restituir y de
    // escribir el nuevo estado, para nunca revivir una venta ya anulada por otro proceso, ni
    // perder una devolucion parcial que ya se aplico en el servidor pero no llego todavia a
    // esta pantalla.
    let _r;
    try {
      _r = await runTransactionM(dbModular, async (tx) => {
        const snap = await tx.get(ventaRef); // lectura garantizada real del servidor
        if (!snap.exists()) throw new Error('Esta venta ya no existe en el servidor.'); // en modular, exists es un METODO
        const vServidor = snap.data();
        if (vServidor.estado === 'anulado') throw new Error('Esta venta ya fue anulada (por otro proceso).');

        const montoReembolso = vServidor.total;
        const _deltasStock = [];
        (vServidor.items||[]).forEach(item => {
          const prod = DB.productos.find(p => p.id === item.prodId);
          if (prod) {
            const cantOrig = item.cantReal ?? item.cant;
            const yaDevuelto = (vServidor.devoluciones||[]).reduce((s,d) => {
              const di = d.items?.find(x=>x.prodId===item.prodId);
              return s + (di?.cantDevuelta||0);
            }, 0);
            const cantARestituir = Math.max(0, cantOrig - yaDevuelto);
            if (cantARestituir > 0) {
              tx.set(docM(dbModular, 'productos', String(prod.id)), { stock: incrementM(cantARestituir) }, { merge: true });
              _deltasStock.push({ prod, delta: cantARestituir });
              const _promoAsoc = DB.promociones.find(p => p.limite > 0 && (p.packProdId === prod.id || p.prod1 == prod.id));
              if (_promoAsoc) {
                tx.set(docM(dbModular, 'promociones', String(_promoAsoc.id)), { vendidos: incrementM(-cantARestituir) }, { merge: true });
              }
            }
          }
        });

        const _movId = getId();
        const _movData = {
          id: _movId, tipo: 'egreso',
          desc: `Reembolso anulación venta — ${vServidor.cajero||vServidor.clienteNombre||'cliente'} (${metodo})`,
          monto: montoReembolso, hora: nowTime(), fecha: today(), usuario: autoriza, sedeId: _sedeDev
        };
        tx.set(docM(dbModular, 'movimientos', String(_movId)), _movData);

        const _cajaUpdate = { egresos: incrementM(montoReembolso) };
        if (metodo === 'Efectivo') _cajaUpdate.egresosEfectivo = incrementM(montoReembolso);
        tx.set(docM(dbModular, 'caja', _sedeDev), _cajaUpdate, { merge: true });

        const _devolucionEntry = {
          fecha: today(), hora: nowTime(), tipo: 'anulacion',
          monto: montoReembolso, metodo, obs, autoriza,
          items: (vServidor.items||[]).map(item => ({
            prodId: item.prodId, nombre: item.nombre,
            cantDevuelta: item.cantReal ?? item.cant
          }))
        };
        const _fechaAnulacion = today() + ' ' + nowTime();
        tx.set(ventaRef, {
          devoluciones: [...(vServidor.devoluciones||[]), _devolucionEntry],
          estado: 'anulado', total: 0, fechaAnulacion: _fechaAnulacion
        }, { merge: true });

        return { montoReembolso, _deltasStock, _movData, _devolucionEntry, _fechaAnulacion };
      });
    } catch (e) {
      alert('⚠️ No se pudo anular la venta: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
      return;
    }

    // La transaccion ya fue aceptada — recien ahora se refleja en memoria local.
    _r._deltasStock.forEach(({prod, delta}) => {
      prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
    });
    DB.caja.egresos = (DB.caja.egresos||0) + _r.montoReembolso;
    if (metodo === 'Efectivo') DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + _r.montoReembolso;

    if (!vDB.devoluciones) vDB.devoluciones = [];
    vDB.devoluciones.push(_r._devolucionEntry);
    vDB.estado         = 'anulado';
    vDB.total          = 0;
    vDB.fechaAnulacion = _r._fechaAnulacion;
    if (!DB.movimientos) DB.movimientos = [];
    DB.movimientos.push(_r._movData);

    fbGuardar();
    cerrarModal('modal-actualizar-venta');
    renderHistorialVentas();
    try { renderInvTable(); } catch(e){}
    try { renderCaja(); } catch(e){}
    try { renderDashboard(); } catch(e){}
    try { generarReporte(); } catch(e){}
    alert(`✅ Venta anulada correctamente.\n💰 Reembolso registrado: ${sol(_r.montoReembolso)} (${metodo})\n📦 Stock restituido en inventario.`);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CASO B: Devolución parcial
  // ══════════════════════════════════════════════════════════════════════════
  const items = _huvVenta.items || [];
  const itemsDevueltos = [];

  items.forEach((item, i) => {
    const input = document.getElementById('huv-dev-' + i);
    const cantDev = parseFloat(input?.value) || 0;
    if (cantDev <= 0) return;
    itemsDevueltos.push({
      prodId: item.prodId, nombre: item.nombre,
      cantDevuelta: cantDev, precioUnit: item.precio,
      subtotal: cantDev * item.precio
    });
  });

  if (itemsDevueltos.length === 0) {
    alert('Ingresa al menos un producto a devolver (cantidad > 0).'); return;
  }

  const _montoReembolsoEstimado = itemsDevueltos.reduce((s,d) => s + d.subtotal, 0);
  if (!confirm(`¿Confirmar devolución parcial?\n\nProductos:\n${itemsDevueltos.map(d=>`• ${d.nombre} x${d.cantDevuelta} = ${sol(d.subtotal)}`).join('\n')}\n\nReembolso: ${sol(_montoReembolsoEstimado)} (${metodo})`)) return;

  if (!dbModular) { alert('⚠️ Sin conexión con el sistema en este momento. Espera unos segundos e intenta de nuevo.'); return; } // [SDK modular]
  await ensureCajaAbierta(); // antes de la transaccion — ver nota en ensureCajaAbierta()
  const _sedeDevP = vDB.sedeId || sedeAdminEfectiva();

  // CRITICO: runTransaction — mismo motivo que el caso A. Ademas, revalida cada cantidad a
  // devolver contra el stock REAL ya vendido en el servidor (cantOrig - lo ya devuelto antes),
  // no contra lo que esta pantalla venia mostrando — si una devolucion parcial anterior ya se
  // aplico en el servidor sin reflejarse aca, esta validacion lo detecta y rechaza en vez de
  // permitir devolver de mas.
  let _rP;
  try {
    _rP = await runTransactionM(dbModular, async (tx) => {
      const snap = await tx.get(ventaRef); // lectura garantizada real del servidor
      if (!snap.exists()) throw new Error('Esta venta ya no existe en el servidor.'); // en modular, exists es un METODO
      const vServidor = snap.data();
      if (vServidor.estado === 'anulado') throw new Error('Esta venta ya fue anulada (por otro proceso) — no se puede devolver.');

      let montoReembolso = 0;
      for (const dev of itemsDevueltos) {
        const itemServidor = (vServidor.items||[]).find(i => i.prodId === dev.prodId);
        const cantOrig = itemServidor ? (itemServidor.cantReal ?? itemServidor.cant) : 0;
        const yaDevuelto = (vServidor.devoluciones||[]).reduce((s,d) => {
          const di = d.items?.find(x=>x.prodId===dev.prodId);
          return s + (di?.cantDevuelta||0);
        }, 0);
        const disponibleParaDevolver = Math.max(0, cantOrig - yaDevuelto);
        if (dev.cantDevuelta > disponibleParaDevolver) {
          throw new Error(`No puedes devolver más unidades de las disponibles (${dev.nombre}: disponible ${disponibleParaDevolver}). Puede que ya se haya registrado otra devolución — revisa la venta actualizada.`);
        }
        montoReembolso += dev.subtotal;
      }

      const _deltasStockP = [];
      itemsDevueltos.forEach(dev => {
        const prod = DB.productos.find(p => p.id === dev.prodId);
        if (prod) {
          tx.set(docM(dbModular, 'productos', String(prod.id)), { stock: incrementM(dev.cantDevuelta) }, { merge: true });
          _deltasStockP.push({ prod, delta: dev.cantDevuelta });
          const _promoAsocP = DB.promociones.find(p => p.limite > 0 && (p.packProdId === prod.id || p.prod1 == prod.id));
          if (_promoAsocP) {
            tx.set(docM(dbModular, 'promociones', String(_promoAsocP.id)), { vendidos: incrementM(-dev.cantDevuelta) }, { merge: true });
          }
        }
      });

      const nuevoTotal = Math.max(0, Math.round((vServidor.total - montoReembolso) * 100) / 100);
      const _itemsActualizados = (vServidor.items||[]).map(item => {
        const dev = itemsDevueltos.find(d => d.prodId === item.prodId);
        if (!dev) return item;
        const cantAntes = item.cantReal ?? item.cant;
        return { ...item, cantReal: Math.max(0, cantAntes - dev.cantDevuelta) };
      });
      const _devolucionEntryP = {
        fecha: today(), hora: nowTime(), tipo: 'parcial',
        monto: montoReembolso, metodo, obs, autoriza,
        items: itemsDevueltos
      };
      tx.set(ventaRef, {
        items: _itemsActualizados,
        devoluciones: [...(vServidor.devoluciones||[]), _devolucionEntryP],
        total: nuevoTotal, estado: nuevoTotal === 0 ? 'anulado' : 'parcial'
      }, { merge: true });

      const _movIdP = getId();
      const _movDataP = {
        id: _movIdP, tipo: 'egreso',
        desc: `Reembolso devolución parcial — ${vServidor.cajero||vServidor.clienteNombre||'cliente'} (${metodo})`,
        monto: montoReembolso, hora: nowTime(), fecha: today(), usuario: autoriza, sedeId: _sedeDevP
      };
      tx.set(docM(dbModular, 'movimientos', String(_movIdP)), _movDataP);

      const _cajaUpdateP = { egresos: incrementM(montoReembolso) };
      if (metodo === 'Efectivo') _cajaUpdateP.egresosEfectivo = incrementM(montoReembolso);
      tx.set(docM(dbModular, 'caja', _sedeDevP), _cajaUpdateP, { merge: true });

      return { montoReembolso, nuevoTotal, _deltasStockP, _devolucionEntryP, _movDataP, _itemsActualizados };
    });
  } catch (e) {
    alert('⚠️ No se pudo registrar la devolución: ' + (e.message || 'intenta de nuevo') + '\n\nNo se aplicó nada.');
    return;
  }

  // La transaccion ya fue aceptada — recien ahora se refleja en memoria local.
  _rP._deltasStockP.forEach(({prod, delta}) => {
    prod.stock = Math.max(0, Math.round(((prod.stock||0)+delta)*1000)/1000);
  });
  vDB.items  = _rP._itemsActualizados;
  vDB.total  = _rP.nuevoTotal;
  vDB.estado = _rP.nuevoTotal === 0 ? 'anulado' : 'parcial';
  DB.caja.egresos = (DB.caja.egresos||0) + _rP.montoReembolso;
  if (metodo === 'Efectivo') DB.caja.egresosEfectivo = (DB.caja.egresosEfectivo||0) + _rP.montoReembolso;

  if (!vDB.devoluciones) vDB.devoluciones = [];
  vDB.devoluciones.push(_rP._devolucionEntryP);
  if (!DB.movimientos) DB.movimientos = [];
  DB.movimientos.push(_rP._movDataP);

  fbGuardar();
  cerrarModal('modal-actualizar-venta');
  renderHistorialVentas();
  try { renderInvTable(); } catch(e){}
  try { renderCaja(); } catch(e){}
  try { renderDashboard(); } catch(e){}
  try { generarReporte(); } catch(e){}
  alert(`✅ Devolución registrada correctamente.\n💰 Reembolso: ${sol(_rP.montoReembolso)} (${metodo})\n📦 Stock restituido.\nNuevo total de la venta: ${sol(_rP.nuevoTotal)}`);
}

// ===================== EXCEL IMPORTAR / EXPORTAR =====================

// --- Mostrar panel solo si es admin ---
function initExcelPanel() {
  const panel = document.getElementById('excel-panel-inv');
  if (!panel) return;
  panel.style.display = (currentRole === 'admin') ? 'block' : 'none';
  // Llenar filtro de categorías
  const sel = document.getElementById('xls-filtro-cat');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas</option>';
  (DB.categorias || []).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.emoji || ''} ${c.nombre}</option>`;
  });
}

function toggleExcelPanel() {
  const body = document.getElementById('excel-panel-body');
  const header = document.getElementById('excel-panel-toggle');
  const arrow = document.getElementById('excel-panel-arrow');
  const open = body.classList.toggle('open');
  header.classList.toggle('open', open);
  arrow.style.transform = open ? 'rotate(180deg)' : '';
}

// --- EXPORTAR ---
function exportarExcelInventario() {
  if (!window.XLSX) { _loadXLSX(function(){ exportarExcelInventario(); }); return; }
  if (currentRole !== 'admin') { alert('Solo el administrador puede exportar el inventario.'); return; }

  let prods = JSON.parse(JSON.stringify(DB.productos));

  // Filtros
  const filtCat   = document.getElementById('xls-filtro-cat').value;
  const filtEst   = document.getElementById('xls-filtro-estado').value;
  const filtVenc  = document.getElementById('xls-filtro-venc').value;
  const filtDesde = document.getElementById('xls-filtro-desde').value;
  const filtHasta = document.getElementById('xls-filtro-hasta').value;
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  if (filtCat)   prods = prods.filter(p => String(p.cat) === String(filtCat));
  if (filtEst === 'con-stock')  prods = prods.filter(p => p.stock > 0);
  if (filtEst === 'bajo')       prods = prods.filter(p => p.stock <= p.stockMin);
  if (filtEst === 'ok')         prods = prods.filter(p => p.stock > p.stockMin && (!p.venc || diasHasta(p.venc) > 7));
  if (filtVenc === 'vence-7')   prods = prods.filter(p => p.venc && diasHasta(p.venc) >= 0 && diasHasta(p.venc) <= 7);
  if (filtVenc === 'vence-30')  prods = prods.filter(p => p.venc && diasHasta(p.venc) >= 0 && diasHasta(p.venc) <= 30);
  if (filtVenc === 'vencido')   prods = prods.filter(p => p.venc && diasHasta(p.venc) < 0);
  if (filtVenc === 'sin-venc')  prods = prods.filter(p => !p.venc);
  if (filtDesde) prods = prods.filter(p => p.venc && p.venc >= filtDesde);
  if (filtHasta) prods = prods.filter(p => p.venc && p.venc <= filtHasta);

  if (!prods.length) { alert('No hay productos con los filtros seleccionados.'); return; }

  // Construir filas con nombres legibles
  const filas = prods.map(p => {
    const cat = DB.categorias.find(c => c.id == p.cat);
    const prov = DB.proveedores ? DB.proveedores.find(v => v.id == p.prov) : null;
    return {
      'ID_SISTEMA':     p.id,
      'Codigo_Barras':  p.codigo || '',
      'Nombre':         p.nombre,
      'Marca':          p.marca || '',
      'Compra_Impulso': p.esImpulso ? 'Si' : 'No',
      'Categoria':      cat ? (cat.emoji + ' ' + cat.nombre) : '',
      'ID_Categoria':   p.cat || '',
      'Tipo':           p.tipo || 'unidad',
      'Unidad':         p.unidad || 'und',
      'Stock':          stockTotal(p),
      'Stock_Minimo':   p.stockMin,
      'Precio_Costo':   p.costo,
      'Precio_Venta':   p.precio,
      'Vencimiento':    p.venc || '',
      'ID_Proveedor':   p.prov || '',
      'Proveedor':      prov ? prov.nombre : ''
    };
  });

  // Crear hoja con instrucciones en fila 1
  const ws = XLSX.utils.json_to_sheet(filas);

  // Ancho de columnas
  ws['!cols'] = [
    {wch:14},{wch:16},{wch:28},{wch:16},{wch:14},{wch:22},{wch:12},{wch:10},{wch:8},
    {wch:11},{wch:12},{wch:13},{wch:12},{wch:13},{wch:12},{wch:22}
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

  // Hoja de instrucciones
  const instrData = [
    ['INSTRUCCIONES PARA MODIFICAR Y REIMPORTAR'],
    [''],
    ['1. NO borrar ni modificar la columna ID_SISTEMA (es la clave de identificacion)'],
    ['2. Puede modificar: Nombre, Tipo, Unidad, Stock, Stock_Minimo, Precio_Costo, Precio_Venta, Vencimiento, ID_Categoria, ID_Proveedor, Codigo_Barras'],
    ['3. Para AGREGAR un producto nuevo: deje ID_SISTEMA en BLANCO y complete todos los demas campos'],
    ['4. La columna Categoria y Proveedor son solo referencia visual, el sistema usa ID_Categoria e ID_Proveedor'],
    ['5. El formato de Vencimiento debe ser: AAAA-MM-DD (ej: 2026-12-31). Dejar en blanco si no aplica'],
    ['6. Guarde el archivo y vuelvalo a subir en el sistema para actualizar'],
    [''],
    ['CATEGORIAS DISPONIBLES:'],
    ['ID', 'Nombre']
  ];
  (DB.categorias || []).forEach(c => instrData.push([c.id, c.emoji + ' ' + c.nombre]));
  instrData.push(['']);
  instrData.push(['PROVEEDORES DISPONIBLES:']);
  instrData.push(['ID', 'Nombre']);
  (DB.proveedores || []).forEach(v => instrData.push([v.id, v.nombre]));

  const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
  wsInstr['!cols'] = [{wch:12},{wch:40}];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  const fecha = today().replace(/-/g,'');
  XLSX.writeFile(wb, `inventario_aleze_${fecha}.xlsx`);
}

// --- IMPORTAR: Drag & Drop ---
function onExcelDrop(e) {
  e.preventDefault();
  document.getElementById('excel-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) procesarArchivoExcel(file);
}

function onExcelFileSelect(e) {
  const file = e.target.files[0];
  if (file) procesarArchivoExcel(file);
  e.target.value = '';
}

// --- IMPORTAR: Procesar archivo ---
let _excelCambiosPendientes = [];
// Categorías nuevas detectadas en el Excel para configurar margen
let _excelCategoriasNuevas = [];

// Convierte número serial de Excel a fecha YYYY-MM-DD
function excelSerialToDate(serial) {
  if (!serial && serial !== 0) return '';
  // Handle JavaScript Date object (SheetJS cellDates:true)
  if (serial instanceof Date) {
    if (isNaN(serial.getTime())) return '';
    const y = serial.getFullYear();
    const m = String(serial.getMonth()+1).padStart(2,'0');
    const d = String(serial.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  // If already YYYY-MM-DD
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(serial)) return serial;
  // If Excel serial number
  if (typeof serial === 'number') {
    const utcDays = serial - 25569;
    const date = new Date(utcDays * 86400000);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  }
  const s = serial.toString().trim();
  // M/D/YYYY or MM/DD/YYYY (US Excel format — month first)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/');
    const mo = parts[0], dy = parts[1], yr = parts[2];
    // US format: mo/dy/yr
    return `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
  }
  // M/D/YY (US format with 2-digit year, e.g. 8/20/26)
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) {
    const parts = s.split('/');
    const mo = parts[0], dy = parts[1], yr = '20' + parts[2];
    return `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
  }
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd,mm,yyyy] = s.split('-');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

// Fuerza lectura de ID_SISTEMA como número completo (evita notación científica)
function parseIdSistema(val) {
  if (!val && val !== 0) return '';
  if (typeof val === 'number') return Math.round(val).toString();
  return val.toString().trim();
}

// CRITICO: codigos de barras largos (EAN-13, 13 digitos) guardados en una celda sin formato
// de texto explicito en Excel a veces quedan en notacion cientifica ("7.78211E+12") — Number()
// SI puede interpretar ese string correctamente, toFixed(0) lo vuelve a un entero normal.
function parseCodigoBarras(val) {
  if (!val && val !== 0) return '';
  const str = val.toString().trim();
  if (/e\+?\d+/i.test(str)) {
    const num = Number(str);
    if (!isNaN(num)) return num.toFixed(0);
  }
  return str;
}

function procesarArchivoExcel(file) {
  if (!window.XLSX) { _loadXLSX(function(){ procesarArchivoExcel(file); }); return; }
  if (currentRole !== 'admin') { alert('Solo el administrador puede importar.'); return; }
  if (!file.name.match(/\.(xlsx|xls)$/i)) { alert('Por favor sube un archivo .xlsx o .xls'); return; }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      // cellText:true → fuerza lectura de celdas numéricas grandes como texto (evita notación científica)
      const wb = XLSX.read(data, { type: 'array', cellText: false, cellDates: true });
      const ws = wb.Sheets['Inventario'];
      if (!ws) { alert('❌ El archivo no tiene una hoja llamada "Inventario". Asegúrate de exportar desde este sistema.'); return; }

      const filas = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      if (!filas.length) { alert('La hoja Inventario está vacía.'); return; }

      // Detectar cambios
      const cambios = [];
      _excelCategoriasNuevas = [];
      const idsCategoriasNuevas = new Set();

      filas.forEach(fila => {
        // ID_SISTEMA: manejar notación científica
        const idSistemaRaw = fila['ID_SISTEMA'];
        const idSistema = parseIdSistema(idSistemaRaw);

        if (!idSistema || idSistema === '') {
          // Producto NUEVO
          if (!fila['Nombre'] || fila['Nombre'].toString().trim() === '') return;

          // Detectar si la categoría es nueva
          const catId = parseInt(fila['ID_Categoria']);
          if (catId && !DB.categorias.find(c => c.id == catId) && !idsCategoriasNuevas.has(catId)) {
            idsCategoriasNuevas.add(catId);
            _excelCategoriasNuevas.push({
              idOriginal: catId,
              nombre: (fila['Categoria'] || '').replace(/^[^\w]+/, '').trim() || 'Categoría ' + catId,
              margen: 30
            });
          }

          // Normalizar fecha de vencimiento
          const filaFixed = { ...fila };
          if (filaFixed['Vencimiento']) {
            filaFixed['Vencimiento'] = excelSerialToDate(filaFixed['Vencimiento']);
          }
          cambios.push({ tipo: 'nuevo', fila: filaFixed });
          return;
        }

        const prodExistente = DB.productos.find(p => String(p.id) === idSistema);
        if (!prodExistente) return; // ID no encontrado, ignorar

        // Comparar campos modificables
        const diffs = [];
        const mapCampos = [
          { key: 'nombre',   col: 'Nombre',         fmt: v => v.toString().trim() },
          { key: 'marca',    col: 'Marca',          fmt: v => v.toString().trim() || null },
          { key: 'esImpulso', col: 'Compra_Impulso', fmt: v => v.toString().trim().toLowerCase() === 'si' },
          { key: 'tipo',     col: 'Tipo',            fmt: v => v.toString().trim() },
          { key: 'unidad',   col: 'Unidad',          fmt: v => v.toString().trim() },
          { key: 'stockMin', col: 'Stock_Minimo',    fmt: v => parseFloat(v) || 0 },
          { key: 'costo',    col: 'Precio_Costo',    fmt: v => parseFloat(v) || 0 },
          { key: 'precio',   col: 'Precio_Venta',    fmt: v => parseFloat(v) || 0 },
          { key: 'venc',     col: 'Vencimiento',     fmt: v => excelSerialToDate(v) },
          { key: 'cat',      col: 'ID_Categoria',    fmt: v => parseInt(v) || prodExistente.cat },
          { key: 'prov',     col: 'ID_Proveedor',    fmt: v => parseInt(v) || null },
          { key: 'codigo',   col: 'Codigo_Barras',   fmt: v => parseCodigoBarras(v) },
        ];

        mapCampos.forEach(({ key, col, fmt }) => {
          if (!(col in fila)) return;
          const nuevoVal = fmt(fila[col]);
          const viejoVal = prodExistente[key];
          if (String(nuevoVal) !== String(viejoVal)) {
            diffs.push({ campo: key, etiqueta: col.replace(/_/g,' '), viejo: viejoVal, nuevo: nuevoVal });
          }
        });
        // Stock: se compara contra el total actual del sistema.
        if ('Stock' in fila) {
          const nuevoVal = parseFloat(fila['Stock']) || 0;
          const viejoVal = stockTotal(prodExistente);
          if (nuevoVal !== viejoVal) {
            diffs.push({ campo: 'stock', etiqueta: 'Stock', viejo: viejoVal, nuevo: nuevoVal });
          }
        }

        if (diffs.length > 0) {
          cambios.push({ tipo: 'mod', prodId: idSistema, nombre: prodExistente.nombre, diffs });
        }
      });

      if (!cambios.length) {
        alert('✅ No se detectaron diferencias entre el Excel y el inventario actual. Todo está al día.');
        return;
      }

      // Guardar pendientes
      _excelCambiosPendientes = cambios.map(c => ({ ...c, aceptado: false }));

      // Si hay categorías nuevas, mostrar modal de configuración primero
      if (_excelCategoriasNuevas.length > 0) {
        abrirModalCategoriasNuevasExcel();
      } else {
        renderExcelReviewModal();
        abrirModal('modal-excel-review');
      }

    } catch(err) {
      alert('❌ Error al leer el archivo: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// --- Renderizar modal de revisión ---
function renderExcelReviewModal() {
  const lista = document.getElementById('excel-review-list');
  const nMod = _excelCambiosPendientes.filter(c => c.tipo === 'mod').length;
  const nNew = _excelCambiosPendientes.filter(c => c.tipo === 'nuevo').length;
  document.getElementById('xls-count-mod').textContent = nMod;
  document.getElementById('xls-count-new').textContent = nNew;
  actualizarContadorAceptados();

  lista.innerHTML = _excelCambiosPendientes.map((c, i) => {
    const esNew = c.tipo === 'nuevo';
    const estadoClass = c.aceptado ? (esNew ? 'new-prod accepted' : 'accepted') : (esNew ? 'new-prod' : '');
    const badge = esNew
      ? `<span class="excel-review-badge new">🆕 NUEVO</span>`
      : `<span class="excel-review-badge mod">🔄 MODIFICADO</span>`;
    const nombre = esNew ? (c.fila['Nombre'] || 'Sin nombre') : c.nombre;

    let cambiosHtml = '';
    if (esNew) {
      const cat = DB.categorias.find(cat => cat.id == c.fila['ID_Categoria']);
      cambiosHtml = `
        <div class="excel-review-changes">
          <span class="excel-change-pill">Categoría: <span class="new">${cat ? cat.emoji + ' ' + cat.nombre : c.fila['ID_Categoria'] || 'Sin cat.'}</span></span>
          <span class="excel-change-pill">Stock: <span class="new">${c.fila['Stock']||0}</span></span>
          <span class="excel-change-pill">Costo: <span class="new">S/ ${parseFloat(c.fila['Precio_Costo']||0).toFixed(2)}</span></span>
          <span class="excel-change-pill">Venta: <span class="new">S/ ${parseFloat(c.fila['Precio_Venta']||0).toFixed(2)}</span></span>
          <span class="excel-change-pill">Tipo: <span class="new">${c.fila['Tipo'] || 'unidad'}</span></span>
          ${c.fila['Marca'] ? `<span class="excel-change-pill">Marca: <span class="new">${c.fila['Marca']}</span></span>` : ''}
          ${(c.fila['Compra_Impulso']||'').toString().trim().toLowerCase() === 'si' ? `<span class="excel-change-pill">🍫 Impulso</span>` : ''}
          ${c.fila['Vencimiento'] ? `<span class="excel-change-pill">Venc: <span class="new">${c.fila['Vencimiento']}</span></span>` : ''}
        </div>`;
    } else {
      cambiosHtml = `<div class="excel-review-changes">` +
        c.diffs.map(d => {
          const viejoFmt = typeof d.viejo === 'number' ? (d.campo === 'costo' || d.campo === 'precio' ? 'S/ ' + parseFloat(d.viejo).toFixed(2) : d.viejo) : (d.viejo || '—');
          const nuevoFmt = typeof d.nuevo === 'number' ? (d.campo === 'costo' || d.campo === 'precio' ? 'S/ ' + parseFloat(d.nuevo).toFixed(2) : d.nuevo) : (d.nuevo || '—');
          return `<span class="excel-change-pill">${d.etiqueta}: <span class="old">${viejoFmt}</span><span class="new">${nuevoFmt}</span></span>`;
        }).join('') +
        `</div>`;
    }

    const btnAccept = c.aceptado
      ? `<button class="btn-reject-change" onclick="toggleExcelCambio(${i})">↩ Deshacer</button>`
      : `<button class="btn-accept-change" onclick="toggleExcelCambio(${i})">✅ Aceptar</button>`;

    return `
      <div class="excel-review-item ${estadoClass}" id="excel-item-${i}">
        <div class="excel-review-header">
          <span class="excel-review-name">${nombre}</span>
          ${badge}
        </div>
        ${cambiosHtml}
        <div class="excel-review-actions">
          ${btnAccept}
          <span style="font-size:0.75rem;color:var(--gray-400);margin-left:0.3rem">${c.aceptado ? '✔ Incluido en la actualización' : 'Pendiente de revisión'}</span>
        </div>
      </div>`;
  }).join('');
}

function toggleExcelCambio(i) {
  _excelCambiosPendientes[i].aceptado = !_excelCambiosPendientes[i].aceptado;
  renderExcelReviewModal();
}

function aceptarTodosExcel() {
  _excelCambiosPendientes.forEach(c => c.aceptado = true);
  renderExcelReviewModal();
}

function rechazarTodosExcel() {
  _excelCambiosPendientes.forEach(c => c.aceptado = false);
  renderExcelReviewModal();
}

function actualizarContadorAceptados() {
  const n = _excelCambiosPendientes.filter(c => c.aceptado).length;
  document.getElementById('xls-count-accepted').textContent = n;
  const disabled = n === 0;
  document.getElementById('btn-aplicar-excel').disabled = disabled;
  document.getElementById('btn-aplicar-excel-2').disabled = disabled;
}

function aplicarCambiosExcel() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede aplicar cambios de Excel.'); return; }
  const aceptados = _excelCambiosPendientes.filter(c => c.aceptado);
  if (!aceptados.length) { alert('No hay cambios aceptados para aplicar.'); return; }

  let modCount = 0, newCount = 0;
  const prodsSinCodigo = [];
  const _idsAfectados = [];

  // IDs únicos garantizados — evita colisiones en importaciones masivas
  const _idsUsados = new Set(DB.productos.map(p => p.id));
  const _getUniqueId = () => {
    let id;
    do { id = getId(); } while (_idsUsados.has(id));
    _idsUsados.add(id);
    return id;
  };

  aceptados.forEach(c => {
    if (c.tipo === 'mod') {
      const idx = DB.productos.findIndex(p => String(p.id) === String(c.prodId));
      if (idx === -1) return;
      const prod = DB.productos[idx];
      c.diffs.forEach(d => {
        if (d.campo === 'stock') {
          const delta = Math.round((d.nuevo - d.viejo) * 1000) / 1000;
          if (delta !== 0) ajustarStockSede(prod, delta);
        } else {
          prod[d.campo] = d.nuevo;
        }
      });
      _idsAfectados.push(prod.id);
      modCount++;
    } else if (c.tipo === 'nuevo') {
      const f = c.fila;
      const codigoIngresado = f['Codigo_Barras'] ? parseCodigoBarras(f['Codigo_Barras']) : '';
  const codigoFinal = codigoIngresado || ('7' + _getUniqueId().toString().slice(-12));
      const autoGenerado = !codigoIngresado;
      const stockInicial = parseFloat(f['Stock']) || 0;
      const nuevoProd = {
       id: _getUniqueId(),
        nombre:   f['Nombre'].toString().trim(),
        marca:    f['Marca'] ? f['Marca'].toString().trim() : null,
        esImpulso: f['Compra_Impulso'] ? f['Compra_Impulso'].toString().trim().toLowerCase() === 'si' : false,
        cat:      parseInt(f['ID_Categoria']) || (DB.categorias[0] ? DB.categorias[0].id : 1),
        tipo:     f['Tipo'] || 'unidad',
        unidad:   f['Unidad'] || 'und',
        costo:    parseFloat(f['Precio_Costo']) || 0,
        precio:   parseFloat(f['Precio_Venta']) || 0,
        stock: 0,
        stockMin: parseFloat(f['Stock_Minimo']) || 5,
        venc:     f['Vencimiento'] ? excelSerialToDate(f['Vencimiento'].toString().trim()) : '',
        codigo:   codigoFinal,
        prov:     parseInt(f['ID_Proveedor']) || null
      };
      // Auto-calculate price from category margin when price is 0
      if (nuevoProd.precio === 0 && nuevoProd.costo > 0) {
        const catObj = DB.categorias.find(c => c.id === nuevoProd.cat);
        if (catObj && catObj.margen > 0) {
          nuevoProd.precio = precioSugerido(nuevoProd.costo, catObj.margen);
        }
      }
      DB.productos.push(nuevoProd);
      if (stockInicial > 0) ajustarStockSede(nuevoProd, stockInicial);
      if (autoGenerado) prodsSinCodigo.push({ nombre: nuevoProd.nombre, codigo: codigoFinal });
      _idsAfectados.push(nuevoProd.id);
      newCount++;
    }
  });

  fbGuardarProductosLote(_idsAfectados);
  cerrarModal('modal-excel-review');
  renderInvTable();
  updateAlertCount();
  try { renderDashboard(); } catch(e) {}
  try { renderPos(); } catch(e) {}

  _excelCambiosPendientes = [];

  const msg = [];
  if (modCount) msg.push(`${modCount} producto(s) actualizado(s)`);
  if (newCount) msg.push(`${newCount} producto(s) nuevo(s) agregado(s)`);
  let alertMsg = '✅ ' + msg.join(' · ') + '. Inventario sincronizado correctamente.';

  if (prodsSinCodigo.length > 0) {
    alertMsg += '\n\n⚠️ CÓDIGOS DE BARRAS AUTOGENERADOS:\nLos siguientes productos no tenían código — se les asignó uno automático. Puedes editarlo desde el inventario:\n\n';
    prodsSinCodigo.forEach(p => { alertMsg += `• ${p.nombre}\n  Código: ${p.codigo}\n`; });
    alertMsg += '\nTe recomendamos asignar un código real escaneando el producto en el inventario.';
  }
  alert(alertMsg);
}

// ===================== FIN EXCEL =====================

// ── Modal: categorías nuevas detectadas en Excel ──────────────────────────────
function abrirModalCategoriasNuevasExcel() {
  let html = `
    <div style="font-size:.85rem;color:var(--gray-600);margin-bottom:1rem">
      Se detectaron <strong>${_excelCategoriasNuevas.length}</strong> categoría(s) que no existen en el sistema.
      Configura el margen de rentabilidad o asigna una categoría existente.
    </div>`;
  _excelCategoriasNuevas.forEach((cat, i) => {
    html += `
    <div style="background:var(--warning-light);border-left:4px solid var(--warning);border-radius:8px;padding:.75rem;margin-bottom:.75rem">
      <div style="font-weight:700;margin-bottom:.5rem">⚠️ Nueva categoría: "${cat.nombre}" (ID ${cat.idOriginal})</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem">Margen de rentabilidad (%)</label>
          <input type="number" class="form-control" id="excat-margen-${i}" value="${cat.margen}" min="0" max="200" step="1" style="font-size:.85rem" />
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:.75rem">O seleccionar categoría existente</label>
          <select class="form-control" id="excat-existente-${i}" style="font-size:.85rem">
            <option value="">— Crear nueva —</option>
            ${DB.categorias.map(c=>`<option value="${c.id}">${c.emoji} ${c.nombre} (${c.margen||0}%)</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`;
  });
  // Inyectar modal dinámico si no existe
  let modal = document.getElementById('modal-excel-cats-nuevas');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-excel-cats-nuevas';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>🆕 Categorías nuevas detectadas</h3>
          <button class="modal-close" onclick="cerrarModal('modal-excel-cats-nuevas')">✕</button>
        </div>
        <div id="modal-excel-cats-body"></div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
          <button class="btn btn-outline" onclick="cerrarModal('modal-excel-cats-nuevas')">Cancelar importación</button>
          <button class="btn btn-primary" onclick="confirmarCategoriasNuevasExcel()">✅ Confirmar y continuar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('modal-excel-cats-body').innerHTML = html;
  abrirModal('modal-excel-cats-nuevas');
}

function confirmarCategoriasNuevasExcel() {
  // Procesar cada categoría nueva
  _excelCategoriasNuevas.forEach((cat, i) => {
    const existenteId = parseInt(document.getElementById('excat-existente-'+i)?.value);
    const margen = parseFloat(document.getElementById('excat-margen-'+i)?.value) || 30;

    if (existenteId) {
      // Reasignar el ID de la categoría en los productos nuevos del Excel
      _excelCambiosPendientes.forEach(c => {
        if (c.tipo === 'nuevo' && parseInt(c.fila['ID_Categoria']) === cat.idOriginal) {
          c.fila['ID_Categoria'] = existenteId;
          // Apply existing category margin if price is 0
          const existCat = DB.categorias.find(x => x.id === existenteId);
          if (existCat && existCat.margen > 0 && parseFloat(c.fila['Precio_Venta']||0) === 0) {
            const costo = parseFloat(c.fila['Precio_Costo']||0);
            if (costo > 0) c.fila['Precio_Venta'] = precioSugerido(costo, existCat.margen);
          }
        }
      });
    } else {
      // Crear la categoría nueva con el margen configurado
      const nuevaCat = {
        id: cat.idOriginal,
        nombre: cat.nombre,
        emoji: '📦',
        margen: margen
      };
      // Verificar que el ID no colisione
      const idFinal = DB.categorias.find(c => c.id === cat.idOriginal) ? getId() : cat.idOriginal;
      nuevaCat.id = idFinal;
      DB.categorias.push(nuevaCat);
      // Si hubo cambio de ID, actualizar en los cambios pendientes
      // Also apply margin to calculate prices for new products in this category
      _excelCambiosPendientes.forEach(c => {
        if (c.tipo === 'nuevo' && parseInt(c.fila['ID_Categoria']) === cat.idOriginal) {
          if (idFinal !== cat.idOriginal) c.fila['ID_Categoria'] = idFinal;
          // Auto-price from margin when Precio_Venta is 0
          if (margen > 0 && parseFloat(c.fila['Precio_Venta']||0) === 0) {
            const costo = parseFloat(c.fila['Precio_Costo']||0);
            if (costo > 0) c.fila['Precio_Venta'] = precioSugerido(costo, margen);
          }
        }
      });
    }
  });

  cerrarModal('modal-excel-cats-nuevas');
  renderExcelReviewModal();
  abrirModal('modal-excel-review');
}
