// ===================== BACKUP AUTOMÁTICO =====================
// ── Respaldo completo: catálogo + las 9 colecciones propias, no solo aleze/db ──
// Firestore limita cada documento a 1 MB — por eso el respaldo se guarda como VARIOS
// documentos (uno principal + uno por colección), no todo apretado en uno solo. Ventas y
// movimientos se acotan a 30 días (mismo criterio que la poda local); el resto va completo.
const _BACKUP_COLECCIONES_COMPLETAS = ['fiados', 'caja', 'clientes'];
const _BACKUP_COLECCIONES_30DIAS = ['ventas', 'movimientos', 'mermas', 'gastos', 'boletas'];

async function _leerColeccionParaBackup(nombreColeccion, filtrarDesde) {
  if (!dbModular) return []; // [SDK modular]
  // CRITICO: antes esta funcion atrapaba CUALQUIER error (incluido permission-denied) y
  // devolvia [] — desde afuera, un fallo real de permisos se veia identico a "la coleccion
  // esta vacia", y el backup se reportaba como "completo" aunque le faltara una coleccion
  // entera. El sistema de deteccion de fallos (Promise.allSettled en _ejecutarBackup) ya
  // existia y funciona bien — solo hacia falta dejar que el error se propague hasta el, en
  // vez de silenciarlo aca.
  const colRef = collectionM(dbModular, nombreColeccion);
  const q = filtrarDesde ? queryM(colRef, whereM('fecha', '>=', filtrarDesde)) : colRef;
  const snap = await getDocsM(q);
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

// Divide un array de items en grupos que quepan holgadamente bajo el limite real de 1 MB por
// documento de Firestore — por TAMAÑO real en bytes serializados, no por una cantidad fija de
// items. Una cantidad fija fallaria igual con el tiempo: una coleccion de items grandes (ej.
// boletas con muchos productos cada una) podria seguir superando 1 MB con pocos items, y una
// de items chicos desperdiciaria espacio de sobra. 700 KB de margen bajo el limite real deja
// espacio para el resto de campos del documento sin arriesgar el limite duro de Firestore.
function _dividirPorTamano(items, maxBytesPorChunk = 700000) {
  const chunks = [];
  let actual = [];
  let tamanoActual = 2; // "[]"
  for (const item of items) {
    const tamanoItem = JSON.stringify(item).length + 1; // +1 por la coma de separacion
    if (actual.length > 0 && tamanoActual + tamanoItem > maxBytesPorChunk) {
      chunks.push(actual);
      actual = [];
      tamanoActual = 2;
    }
    actual.push(item);
    tamanoActual += tamanoItem;
  }
  if (actual.length > 0) chunks.push(actual);
  return chunks;
}

async function _ejecutarBackup() {
  if (!dbModular || !currentUser) return; // [SDK modular]
  const ahora = new Date();
  const key = 'backup_' + ahora.toISOString().replace(/[:.]/g, '-').substring(0, 16);
  const hace30dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Documento principal: aleze/db (legado) + config — chico, cabe en uno sin riesgo. El
  // catalogo (productos/categorias) YA NO vive aca — se guarda como colecciones satelite
  // chunkeadas, igual que el resto, para que crecer con el tiempo (mas productos,
  // descripciones mas largas) nunca vuelva a acercarse al limite de 1 MB de este documento.
  const payload = JSON.parse(JSON.stringify(DB));
  delete payload.productos; delete payload.categorias; delete payload.pedidosOnline; delete payload.caja;
  payload.cajas = DB._cajas; // ambas sedes, no solo la de quien está logueado
  payload._backupTs = ahora.toISOString();
  payload._backupUser = currentUser;
  payload._backupColecciones = ['productos', 'categorias', ..._BACKUP_COLECCIONES_COMPLETAS, ..._BACKUP_COLECCIONES_30DIAS];

  const _fallos = [];
  const _chunksPorColeccion = {};
  // Guarda una coleccion completa como uno o mas documentos satelite, dividida por tamaño
  // real — nunca un solo documento gigante sin importar cuanto crezca la coleccion.
  async function _guardarColeccionChunkeada(nombre, items) {
    // CRITICO: Firestore rechaza con error cualquier campo con valor undefined literal
    // (distinto de null) — un documento ya guardado en Firestore nunca podria tenerlo (se
    // habria rechazado al escribirse), pero datos en memoria como DB.productos, construidos
    // por logica JS a lo largo de toda la app, si pueden llegar a tener algun campo
    // undefined sin que nadie lo note hasta este momento especifico. JSON.stringify() omite
    // automaticamente cualquier clave con valor undefined — mismo criterio ya usado para el
    // documento principal del backup (mas arriba), faltaba aplicarlo tambien aca.
    items = JSON.parse(JSON.stringify(items));
    const chunks = _dividirPorTamano(items);
    _chunksPorColeccion[nombre] = chunks.length || 1; // al menos 1 aunque este vacia, para que restaurar sepa que existio
    if (chunks.length === 0) {
      await setDocM(docM(dbModular, 'aleze_backups', key + '__' + nombre + '__0'), { items: [] });
      return;
    }
    for (let i = 0; i < chunks.length; i++) {
      await setDocM(docM(dbModular, 'aleze_backups', key + '__' + nombre + '__' + i), { items: chunks[i] });
    }
  }

  try {
    // Productos y categorias ya estan sincronizados en vivo en memoria — no hace falta
    // releerlos de Firestore, a diferencia de las demas colecciones de abajo.
    await _guardarColeccionChunkeada('productos', DB.productos || []);
    await _guardarColeccionChunkeada('categorias', DB.categorias || []);
  } catch (e) {
    _fallos.push({ parte: 'catálogo (productos/categorías)', codigo: e.code || '', mensaje: e.message || String(e) });
  }
  try {
    await setDocM(docM(dbModular, 'aleze_backups', key), payload);
  } catch (e) {
    _fallos.push({ parte: 'documento principal (config)', codigo: e.code || '', mensaje: e.message || String(e) });
  }
  // Un conjunto de documentos aparte por cada colección propia — nunca un solo documento sin
  // importar cuanto crezca. Cada colección reporta su propio resultado individualmente
  // (allSettled, no Promise.all) — así se identifica con certeza CUAL parte especifica fallo
  // y por que, en vez de solo saber que "algo" fallo en algun lugar del lote completo.
  const _trabajos = [
    ..._BACKUP_COLECCIONES_COMPLETAS.map(col => ({ col, filtro: null })),
    ..._BACKUP_COLECCIONES_30DIAS.map(col => ({ col, filtro: hace30dias })),
  ];
  const _resultados = await Promise.allSettled(_trabajos.map(async ({ col, filtro }) => {
    const items = await _leerColeccionParaBackup(col, filtro);
    await _guardarColeccionChunkeada(col, items);
  }));
  _resultados.forEach((r, i) => {
    if (r.status === 'rejected') {
      const e = r.reason;
      _fallos.push({ parte: 'colección "' + _trabajos[i].col + '"', codigo: e?.code || '', mensaje: e?.message || String(e) });
    }
  });
  // El mapa de cuantos chunks tiene cada coleccion se guarda AL FINAL, en un update aparte —
  // asi el documento principal (chico, va primero) no depende de esperar a que termine todo
  // el resto para poder guardarse; si algo de lo demas falla, igual queda un principal usable.
  try {
    await setDocM(docM(dbModular, 'aleze_backups', key), { _chunksPorColeccion }, { merge: true });
  } catch (e) {
    _fallos.push({ parte: 'mapa de fragmentos del respaldo', codigo: e.code || '', mensaje: e.message || String(e) });
  }

  if (_fallos.length === 0) {
    console.log('[Backup] Guardado completo:', key);
    DB.config._ultimoBackupFecha = today();
    fbGuardar();
    _limpiarBackupsViejos();
  } else {
    console.warn('[Backup] Fallos detallados:', _fallos);
    const _detalle = _fallos.map(f => '• ' + f.parte + (f.codigo ? ' [' + f.codigo + ']' : '') + ': ' + f.mensaje).join('\n');
    alert('⚠️ El respaldo del día (' + ahora.toLocaleTimeString('es-PE') + ') no se guardó completo.\n\n' + _detalle + '\n\nSe reintentará en el próximo inicio de sesión.');
  }
}

function iniciarBackupAutomatico() {
  // CRITICO: antes corria cada 30 minutos mientras la sesion de admin estuviera abierta —
  // con colecciones que crecen con el tiempo (clientes, fiados, gastos, mermas, boletas, cada
  // una releida completa en cada corrida, nunca se "limpian" solas), esto generaba miles de
  // lecturas por dia sin necesidad real. El backup sirve para errores puntuales detectables
  // al momento, o un desastre completo muy reciente — no es un archivo historico, restaurar
  // algo de hace semanas es mas riesgo que beneficio. Con eso claro, 1 vez por dia alcanza de
  // sobra — mismo patron ya probado en limpiarAlertasIgnoradasSiCorresponde().
  if (DB.config._ultimoBackupFecha === today()) return; // ya se hizo hoy
  _ejecutarBackup();
}

// Antiguedad maxima de un respaldo — mas alla de esto, ya no tiene sentido restaurarlo (el
// riesgo de perder datos mas recientes reales supera cualquier beneficio de recuperar algo
// tan viejo). Se ejecuta despues de cada backup exitoso, asi el volumen de respaldos
// guardados nunca crece sin limite — siempre se mantiene acotado a esta ventana.
const _BACKUP_ANTIGUEDAD_MAXIMA_DIAS = 15;

async function _limpiarBackupsViejos() {
  if (!dbModular) return; // [SDK modular]
  try {
    const limite = Date.now() - _BACKUP_ANTIGUEDAD_MAXIMA_DIAS * 24 * 60 * 60 * 1000;
    const snap = await getDocsM(collectionM(dbModular, 'aleze_backups'));
    // Solo documentos principales (sin '__') — cada uno sabe, via _chunksPorColeccion, cuantos
    // satelites tiene por coleccion, necesario para poder borrarlos todos correctamente.
    const principalesViejos = snap.docs.filter(d => {
      if (d.id.includes('__')) return false;
      const ts = d.data()._backupTs;
      return ts && new Date(ts).getTime() < limite;
    });
    if (principalesViejos.length === 0) return;

    const idsABorrar = [];
    principalesViejos.forEach(d => {
      const key = d.id;
      idsABorrar.push(key);
      const chunksPorCol = d.data()._chunksPorColeccion || {};
      Object.entries(chunksPorCol).forEach(([col, cantidad]) => {
        for (let i = 0; i < cantidad; i++) idsABorrar.push(key + '__' + col + '__' + i);
      });
    });

    for (let i = 0; i < idsABorrar.length; i += 450) {
      const batch = writeBatchM(dbModular);
      idsABorrar.slice(i, i + 450).forEach(id => batch.delete(docM(dbModular, 'aleze_backups', id)));
      await batch.commit();
    }
    console.log(`[Backup] Limpieza: ${principalesViejos.length} respaldo(s) de más de ${_BACKUP_ANTIGUEDAD_MAXIMA_DIAS} días eliminado(s) (${idsABorrar.length} documento(s) en total).`);
  } catch (e) {
    console.warn('_limpiarBackupsViejos: error', e);
  }
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
    // _chunksPorColeccion solo existe en respaldos guardados con el formato nuevo (varios
    // documentos numerados por coleccion) — null/undefined significa que es un respaldo viejo
    // (un solo documento por coleccion, sin numerar), y se lee con el criterio anterior.
    const _chunksPorColeccion = data._chunksPorColeccion || null;
    const colecciones = (data._backupColecciones || []).filter(c => c !== 'productos' && c !== 'categorias');
    delete data._backupTs; delete data._backupUser; delete data._backupColecciones; delete data._chunksPorColeccion;

    // Lee todos los fragmentos de una coleccion del respaldo, sea el formato nuevo (varios
    // documentos "__0", "__1", ...) o el viejo (un solo documento sin numerar).
    async function _leerColeccionDelBackup(nombre) {
      if (_chunksPorColeccion && _chunksPorColeccion[nombre] != null) {
        const n = _chunksPorColeccion[nombre];
        let items = [];
        for (let i = 0; i < n; i++) {
          const satDoc = await getDocM(docM(dbModular, 'aleze_backups', id + '__' + nombre + '__' + i));
          if (satDoc.exists()) items = items.concat(satDoc.data().items || []);
        }
        return items;
      }
      const satDoc = await getDocM(docM(dbModular, 'aleze_backups', id + '__' + nombre));
      return satDoc.exists() ? (satDoc.data().items || []) : [];
    }

    // Formato nuevo: productos/categorias viven como colecciones satelite, igual que el
    // resto. Formato viejo: vivian dentro del propio payload principal, en _productos/_categorias.
    let productos, categorias;
    if (_chunksPorColeccion) {
      productos = await _leerColeccionDelBackup('productos');
      categorias = await _leerColeccionDelBackup('categorias');
    } else {
      productos = data._productos || [];
      categorias = data._categorias || [];
    }
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
            batch.set(docM(dbModular, 'productos', String(p.id)), JSON.parse(JSON.stringify(p)));
          });
          await batch.commit();
        }
        continue;
      }
      await _vaciarColeccion(col);
      const items = await _leerColeccionDelBackup(col);
      for (let i = 0; i < items.length; i += 450) {
        const batch = writeBatchM(dbModular);
        items.slice(i, i + 450).forEach(item => {
          const { _id, ...resto } = item;
          batch.set(docM(dbModular, col, String(_id)), JSON.parse(JSON.stringify(resto)));
        });
        await batch.commit();
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
