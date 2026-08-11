// ===================== BACKUP AUTOMÁTICO =====================
let _backupTimer = null;
// ── Respaldo completo: catálogo + las 9 colecciones propias, no solo aleze/db ──
// Firestore limita cada documento a 1 MB — por eso el respaldo se guarda como VARIOS
// documentos (uno principal + uno por colección), no todo apretado en uno solo. Ventas y
// movimientos se acotan a 30 días (mismo criterio que la poda local); el resto va completo.
const _BACKUP_COLECCIONES_COMPLETAS = ['boletas', 'fiados', 'mermas', 'gastos', 'caja', 'clientes'];
const _BACKUP_COLECCIONES_30DIAS = ['ventas', 'movimientos'];

async function _leerColeccionParaBackup(nombreColeccion, filtrarDesde) {
  if (!dbModular) return []; // [SDK modular]
  try {
    const colRef = collectionM(dbModular, nombreColeccion);
    const q = filtrarDesde ? queryM(colRef, whereM('fecha', '>=', filtrarDesde)) : colRef;
    const snap = await getDocsM(q);
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('_leerColeccionParaBackup: error en ' + nombreColeccion, e);
    return [];
  }
}

async function _ejecutarBackup() {
  if (!dbModular || !currentUser) return; // [SDK modular]
  const ahora = new Date();
  const key = 'backup_' + ahora.toISOString().replace(/[:.]/g, '-').substring(0, 16);
  const hace30dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Documento principal: aleze/db (legado) + catálogo completo — todo esto es chico, cabe en uno.
  const payload = JSON.parse(JSON.stringify(DB));
  delete payload.productos; delete payload.categorias; delete payload.pedidosOnline; delete payload.caja;
  payload._productos = DB.productos;
  payload._categorias = DB.categorias;
  payload.cajas = DB._cajas; // ambas sedes, no solo la de quien está logueado
  payload._backupTs = ahora.toISOString();
  payload._backupUser = currentUser;
  payload._backupColecciones = [..._BACKUP_COLECCIONES_COMPLETAS, ..._BACKUP_COLECCIONES_30DIAS];

  const _fallos = [];
  try {
    await setDocM(docM(dbModular, 'aleze_backups', key), payload);
  } catch (e) {
    _fallos.push({ parte: 'documento principal (config + catálogo)', codigo: e.code || '', mensaje: e.message || String(e) });
  }
  // Un documento aparte por cada colección propia — evita el límite de 1 MB por documento.
  // Cada uno reporta su propio resultado individualmente (allSettled, no Promise.all) — así
  // se identifica con certeza CUAL parte especifica fallo y por que, en vez de solo saber que
  // "algo" fallo en algun lugar del lote completo.
  const _trabajos = [
    ..._BACKUP_COLECCIONES_COMPLETAS.map(col => ({ col, filtro: null })),
    ..._BACKUP_COLECCIONES_30DIAS.map(col => ({ col, filtro: hace30dias })),
  ];
  const _resultados = await Promise.allSettled(_trabajos.map(async ({ col, filtro }) => {
    const items = await _leerColeccionParaBackup(col, filtro);
    await setDocM(docM(dbModular, 'aleze_backups', key + '__' + col), { items });
  }));
  _resultados.forEach((r, i) => {
    if (r.status === 'rejected') {
      const e = r.reason;
      _fallos.push({ parte: 'colección "' + _trabajos[i].col + '"', codigo: e?.code || '', mensaje: e?.message || String(e) });
    }
  });

  if (_fallos.length === 0) {
    console.log('[Backup] Guardado completo:', key);
  } else {
    console.warn('[Backup] Fallos detallados:', _fallos);
    const _detalle = _fallos.map(f => '• ' + f.parte + (f.codigo ? ' [' + f.codigo + ']' : '') + ': ' + f.mensaje).join('\n');
    alert('⚠️ El respaldo automático de las ' + ahora.toLocaleTimeString('es-PE') + ' no se guardó completo.\n\n' + _detalle + '\n\nEl sistema lo reintentará en 30 minutos.');
  }
}

function iniciarBackupAutomatico() {
  if (_backupTimer) clearInterval(_backupTimer);
  _backupTimer = setInterval(_ejecutarBackup, 30 * 60 * 1000);
}

function verBackups() {
  if (!dbModular) return; // [SDK modular]
  const el = document.getElementById('backup-lista');
  el.innerHTML = '⏳ Cargando respaldos...';
  getDocsM(queryM(collectionM(dbModular, 'aleze_backups'), orderByM('_backupTs', 'desc'), limitM(10)))
    .then(snap => {
      // Solo documentos principales (sin '__') — los de cada colección son satélites del principal.
      const principales = snap.docs.filter(d => !d.id.includes('__'));
      if (!principales.length) { el.innerHTML = 'Sin respaldos disponibles aún.'; return; }
      el.innerHTML = principales.map(d => {
        const ts = new Date(d.data()._backupTs).toLocaleString('es-PE');
        const user = d.data()._backupUser || '?';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid var(--gray-100)"><span>📅 ' + ts + ' — ' + user + '</span><button type="button" class="btn btn-xs btn-danger" onclick="restaurarBackup(this.dataset.id)" data-id="' + d.id + '">↩️ Restaurar</button></div>';
      }).join('');
    })
    .catch(e => { el.innerHTML = 'Error cargando respaldos.'; });
}

async function restaurarBackup(id) {
  if (!confirm('⚠️ ¿Restaurar este respaldo? Los datos actuales (catálogo, stock, ventas, caja, clientes y todo lo demás) se reemplazarán por completo.')) return;
  try {
    const doc = await getDocM(docM(dbModular, 'aleze_backups', id)); // [SDK modular]
    if (!doc.exists()) { alert('Respaldo no encontrado.'); return; } // en modular, exists es un METODO
    const data = doc.data();
    const colecciones = data._backupColecciones || [];
    delete data._backupTs; delete data._backupUser; delete data._backupColecciones;
    const productos = data._productos || [];
    const categorias = data._categorias || [];
    delete data._productos; delete data._categorias;

    _fbLastWriteTs = Date.now();
    _fbEscribiendo = true;
    data._resetToken = true;

    // 1) Documento principal (legado + config)
    await setDocM(docM(dbModular, 'aleze', 'db'), data);
    // 2) categorías + config — productos (con su stock unificado adentro) va aparte, como
    // coleccion, en el paso 3 junto al resto de colecciones propias.
    await setDocM(docM(dbModular, 'aleze', 'db_productos'), { categorias, config: DB.config || {} });
    // 3) Cada colección propia (incluida 'productos'): vaciar la actual y volver a escribir lo respaldado
    for (const col of [...colecciones, 'productos']) {
      if (col === 'productos') {
        await _vaciarColeccion('productos');
        for (let i = 0; i < productos.length; i += 450) {
          const batch = writeBatchM(dbModular);
          productos.slice(i, i + 450).forEach(p => {
            batch.set(docM(dbModular, 'productos', String(p.id)), p);
          });
          await batch.commit();
        }
        continue;
      }
      await _vaciarColeccion(col);
      const satDoc = await getDocM(docM(dbModular, 'aleze_backups', id + '__' + col));
      if (satDoc.exists()) { // en modular, exists es un METODO
        const items = satDoc.data().items || [];
        for (let i = 0; i < items.length; i += 450) {
          const batch = writeBatchM(dbModular);
          items.slice(i, i + 450).forEach(item => {
            const { _id, ...resto } = item;
            batch.set(docM(dbModular, col, String(_id)), resto);
          });
          await batch.commit();
        }
      }
    }

    setTimeout(() => { _fbEscribiendo = false; }, 300);
    alert('✅ Respaldo restaurado por completo — catálogo, stock, y las ' + colecciones.length + ' colecciones incluidas. Recarga la página para ver todo actualizado.');
    try { renderDashboard(); } catch(e) {}
  } catch (e) {
    _fbEscribiendo = false;
    alert('⚠️ No se pudo restaurar completo. Revisa tu conexión e intenta de nuevo.\nCódigo: ' + (e.code || e.message || 'desconocido'));
  }
}
