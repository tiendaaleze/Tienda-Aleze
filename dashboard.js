// ===================== DASHBOARD =====================
function renderDashboard() {
  // Guard: solo renderizar si hay sesión activa
  if (!currentUser) return;
  const hLogoImg = document.getElementById('header-logo-img');
  if (hLogoImg && !hLogoImg.src) hLogoImg.src = _LOGO_B64;
  const hoy = today();
  const mes = getMesActual();
  // Dashboard es diario — tiene más sentido por sede que consolidado, igual que el resto de
  // las pantallas operativas. sueldos/gastos recurrentes/capital quedan sin filtrar más abajo
  // porque son costos compartidos de todo el negocio, no atribuibles a una sede en particular.
  const _sedeDash = sedeAdminEfectiva();
  // Use historialVentas as source of truth (reflects annulments/returns)
  const hvAll = (DB.historialVentas || []).filter(v => (v.sedeId || 'principal') === _sedeDash);
  const ventasHoy = hvAll.filter(v => v.fecha === hoy && v.estado !== 'anulado' && v.estado !== 'fiado' && v.origen !== 'pago_fiado');
  const fiadosCobradosHoy = hvAll.filter(v => v.fecha === hoy && v.origen === 'pago_fiado').reduce((s,v) => s + (v.total||0), 0);
  const totalHoy = ventasHoy.reduce((s, v) => s + (v.total||0), 0);
  const txHoy = ventasHoy.length;
document.getElementById('dash-ventas').textContent = sol(totalHoy + fiadosCobradosHoy);
  document.getElementById('dash-ventas-num').textContent = txHoy + ' transacciones';

  // Rentabilidad hoy — costoVenta() prioriza el costo historico guardado en cada item, y solo
  // cae al costo actual del producto si esa venta es anterior a este arreglo.
  const costoHoy = ventasHoy.reduce((s,v) => s + costoVenta(v), 0);
  // Mermas del día
  const mermasHoy = (DB.mermas||[]).filter(m=>m.fecha===hoy && (m.sedeId||'principal')===_sedeDash).reduce((s,m)=>{
    return s + costoMerma(m);
  },0);
  const gastosHoy = (DB_EXT.gastos||[]).filter(g=>g.fecha===hoy && (g.sedeId||'principal')===_sedeDash).reduce((s,g)=>s+g.monto,0);
  const costoFiadosHoy = hvAll.filter(v => v.fecha === hoy && v.origen === 'pago_fiado').reduce((s,v) => {
    // Costo real guardado al momento del pago (exacto, por item) — si no existe, es un pago anterior a este arreglo, se aproxima por proporción.
    if (v.costoAsociado != null) return s + v.costoAsociado;
 const fiado = (v.fiadoId ? DB.fiados.find(f => f.id === v.fiadoId) : null) || DB.fiados.find(f => f.clienteId === v.clienteId && f.total > 0);
    if (!fiado) return s;
    const prop = Math.min(1, v.total / fiado.total);
    return s + (fiado.items||[]).reduce((ss,i) => ss + ((i.costoUnitario||0) * i.cant * prop), 0);
  }, 0);
  document.getElementById('dash-rent').textContent = sol(totalHoy + fiadosCobradosHoy - costoHoy - costoFiadosHoy - gastosHoy - mermasHoy);

  document.getElementById('dash-stock-bajo').textContent = DB.productos.filter(p => stockEnSede(p) <= p.stockMin).length;
  document.getElementById('dash-vencimientos').textContent = DB.productos.filter(p => p.venc && diasHasta(p.venc) <= 7 && diasHasta(p.venc) >= 0 && stockEnSede(p) > 0).length;

  // Deuda en fiados — por sede, mismo criterio que el resto del dashboard. Capital se retiró
  // de acá (sigue disponible en su propia pantalla) — es algo de largo plazo, no algo del día.
  const _fiadosPendDash = (DB.fiados||[]).filter(f => (f.sedeId||'principal') === _sedeDash && fiadoPendiente(f));
  const _deudaTotalDash = _fiadosPendDash.reduce((s,f) => s + fiadoMontoPendiente(f), 0);
  document.getElementById('dash-fiados-deuda').textContent = sol(_deudaTotalDash);
  document.getElementById('dash-fiados-clientes').textContent = new Set(_fiadosPendDash.map(f=>f.clienteId)).size + ' cliente(s)';

  // Pedidos online pendientes — no se filtra por sede: "quien despacha decide", cualquiera
  // puede necesitar verlo antes de que se asigne a una sede especifica.
  document.getElementById('dash-pedidos-pend').textContent = (DB.pedidosOnline||[]).filter(p => p.estado === 'pendiente').length;

  // Panel financiero mensual
  const ventasMes = hvAll.filter(v=>v.fecha&&v.fecha.startsWith(mes)&&v.estado!=='anulado'&&v.estado!=='fiado').reduce((s,v)=>s+(v.total||0),0);
  const gastosMes = (DB_EXT.gastos||[]).filter(g=>g.fecha&&g.fecha.startsWith(mes) && (g.sedeId||'principal')===_sedeDash).reduce((s,g)=>s+g.monto,0);
  // Sueldos/gastos recurrentes/capital: costos compartidos de todo el negocio, no por sede — quedan sin filtrar a propósito.
  const sueldosMes = Object.values(DB_EXT.sueldos||{}).reduce((s,v)=>s+v,0);
  const gastosRec = (DB_EXT.gastosRec||[]).reduce((s,g)=>s+g.monto,0);
  const costoMes = hvAll.filter(v=>v.fecha&&v.fecha.startsWith(mes)&&v.estado!=='anulado'&&v.estado!=='fiado')
    .reduce((s,v)=>s+costoVenta(v),0);
  const mermasMes = (DB.mermas||[]).filter(m=>m.fecha&&m.fecha.startsWith(mes) && (m.sedeId||'principal')===_sedeDash).reduce((s,m)=>{
    return s + costoMerma(m);
  },0);
  const rentReal = ventasMes - costoMes - gastosMes - sueldosMes - gastosRec - mermasMes - DB_EXT.capital.cuota;
  const deficit = rentReal - DB_EXT.capital.meta;
  document.getElementById('fin-cuota').textContent = sol(DB_EXT.capital.cuota);
  document.getElementById('fin-ing').textContent = sol(ventasMes);
  document.getElementById('fin-def').innerHTML = `<span style="color:${deficit>=0?'var(--accent)':'var(--danger)'}">${deficit>=0?'+':''}${sol(deficit)}</span>`;
  document.getElementById('fin-rr').innerHTML = `<span style="color:${rentReal>=0?'var(--accent)':'var(--danger)'}">${sol(rentReal)}</span>`;

  const alertas = getAlertas().slice(0, 5);
  const icons = { danger: '🔴', warning: '🟡', info: '🔵', success: '🟢' };
  document.getElementById('dash-alertas-list').innerHTML = alertas.length === 0
    ? '<p style="color:var(--gray-500);font-size:0.85rem">✅ Sin alertas</p>'
    : alertas.map(a => `<div class="alert-item ${a.tipo}"><span>${icons[a.tipo]}</span><div class="alert-text"><strong>${a.titulo}</strong><span>${a.sub}</span></div></div>`).join('');

  // Top clientes por gasto — insignia de puntos real, con el valor canjeable si ya alcanza.
  const sortedCli = [...DB.clientes].sort((a,b)=>(b.total||0)-(a.total||0)).slice(0,5);
  const crowns = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  document.getElementById('dash-frecuentes').innerHTML = sortedCli.map((c,i) => {
    const est = estadoFidelizacion(c.id);
    let badgeFid = `<span class="badge" style="background:var(--gray-100);color:var(--gray-500)">${est.saldo} pts</span>`;
    if (est.valorCanjeable > 0) badgeFid = `<span class="badge badge-gold">🎁 Canjeable: ${sol(est.valorCanjeable)}</span>`;
    return `<div class="flex-between" style="padding:.35rem 0;border-bottom:1px solid var(--gray-100)"><span>${crowns[i]} <strong style="font-size:.85rem">${c.alias||c.nombre}</strong></span><div style="text-align:right"><div style="font-size:.85rem;font-weight:700;color:var(--primary)">${sol(c.total||0)}</div>${badgeFid}</div></div>`;
  }).join('');

  // Cumpleaños próximos
  const hd = new Date();
  const cumples = DB.clientes.filter(c=>c.cumple).map(c => {
    const [,m,d] = c.cumple.split('-');
    const diff = Math.ceil((new Date(hd.getFullYear(),parseInt(m)-1,parseInt(d)) - hd) / 86400000);
    return {...c, diff};
  }).filter(c=>c.diff>=0&&c.diff<=30).sort((a,b)=>a.diff-b.diff).slice(0,5);
  document.getElementById('dash-cumples').innerHTML = cumples.length === 0
    ? '<p style="font-size:.82rem;color:var(--gray-500)">Sin cumpleaños en los próximos 30 días</p>'
    : cumples.map(c => `<div class="flex-between" style="padding:.35rem 0;border-bottom:1px solid var(--gray-100)"><span style="font-size:.85rem">🎂 <strong>${c.alias||c.nombre}</strong></span><span class="badge badge-${c.diff===0?'green':c.diff<=2?'orange':'blue'}">${c.diff===0?'¡HOY!':c.diff===1?'Mañana':'En '+c.diff+' días'}</span></div>`).join('');

  // Birthday banner
  const cb = DB.clientes.filter(c => { if(!c.cumple)return false; const[,m,d]=c.cumple.split('-'); return parseInt(m)-1===hd.getMonth()&&parseInt(d)===hd.getDate(); });
  if(cb.length){ document.getElementById('bday-banner').style.display='block'; document.getElementById('bday-msg').textContent='Cumpleaños: '+cb.map(c=>c.alias||c.nombre).join(', '); }
  else document.getElementById('bday-banner').style.display='none';

  renderChartVentas();
}

async function irAStockBajo() {
  await navigate('inventario');
  document.getElementById('inv-estado').value = 'bajo';
  filterInventario();
}

async function irAVencimientos() {
  await navigate('inventario');
  document.getElementById('inv-estado').value = 'vence';
  filterInventario();
}

function renderChartVentas() {
  const labels = [];
  const dataVenta = [];
  const dataGanancia = [];
  // CRITICO — bug real confirmado: usaba DB.historialVentas sin filtrar por sede, mezclando
  // ambas sedes en el mismo grafico. Ademas, para que el grafico sea consistente con la cifra
  // de "hoy" que ya se muestra arriba (ventas al contado + pagos de fiado cobrados ese dia),
  // se cuenta lo mismo por dia: ventas al contado + pagos de fiado, la creacion del fiado en
  // si (todavia no es dinero en mano) esta correctamente excluida.
  const _sedeChart = sedeAdminEfectiva();
  const hvAll = (DB.historialVentas || []).filter(v => (v.sedeId||'principal') === _sedeChart);
  const mermasChart = (DB.mermas||[]).filter(m => (m.sedeId||'principal') === _sedeChart);
  const gastosChart = (DB_EXT.gastos||[]).filter(g => (g.sedeId||'principal') === _sedeChart);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }));
    const _delDia = hvAll.filter(v => v.fecha === ds && v.estado !== 'anulado' && v.estado !== 'fiado');
    const _ventaDia = _delDia.reduce((s, v) => s + (v.total||0), 0);
    dataVenta.push(_ventaDia);
    // Ganancia real del dia — mismo criterio completo que "Rentabilidad hoy" arriba: venta
    // menos costo real de lo vendido, menos gastos y mermas de ESE dia especifico. No es solo
    // margen bruto, es la ganancia real despues de los costos operativos del dia.
    const _costoDia   = _delDia.reduce((s, v) => s + costoVenta(v), 0);
    const _gastosDia  = gastosChart.filter(g => g.fecha === ds).reduce((s,g) => s + g.monto, 0);
    const _mermasDia  = mermasChart.filter(m => m.fecha === ds).reduce((s,m) => s + costoMerma(m), 0);
    dataGanancia.push(Math.round((_ventaDia - _costoDia - _gastosDia - _mermasDia) * 100) / 100);
  }
  if (chartVentas) chartVentas.destroy();
  const ctx = document.getElementById('chart-ventas').getContext('2d');
  chartVentas = new Chart(ctx, {
    data: { labels, datasets: [
      { type: 'bar', label: 'Venta (S/)', data: dataVenta, backgroundColor: '#C4B5FD', borderRadius: 6, order: 2 },
      { type: 'line', label: 'Ganancia real (S/)', data: dataGanancia, borderColor: '#10B981', backgroundColor: '#10B981', tension: 0.3, order: 1, pointRadius: 4, pointBackgroundColor: '#10B981' }
    ]},
    options: { plugins: { legend: { display: true, position: 'bottom' } }, scales: { y: { beginAtZero: true } }, responsive: true }
  });
}

