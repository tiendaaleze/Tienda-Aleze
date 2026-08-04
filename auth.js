// ===================== LOGIN =====================
// ── Bloqueo por intentos fallidos ──────────────────────────────────────────
// Logo embebido como constante — evita duplicar base64 en el DOM
const _LOGO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAH30lEQVR4nO3dO5MUVRjG8fcsDcgKgZSFsQTuBSMpr6g5oR9AE/eGmYWpEalVZgILEV/ATHNhuSmZcgnkA1AWBgvrUlzWoKehaXpm+nL63N7/j5qAYdiZ2X6eOed0z/SYL9/+RQKy4/sBwAnj+wEUMs/3T+B1qm53b4VwXQACjzreCuGqAAQfbRR5GbwI2cD3QfDRx+BFGGoEIPiwabAi2C4AwceQrBchM/Z+FuGHKztiqQSZpfwTfrhmpQR9p0AEHz71nhLNWLhzwLfOWey6G5TwIzSdpkRdRgDCj1C1zmbWsjKEH6FrNRK0mQIRfsSicQmaToEIP2LTKLO2jgMAUWoyAvDqj1hNze60NQDhR+wmrgcm7QUi/EjF2BL0ORIMRG/cFIhXf6SmdhRgBIBqdQXg1R+peiXbHAeAatVPhPHqj9S9tBZgDQDVygXg1R9aPM/60OcFAoLGFAiqUQColpl8BsT8H9rsiIhhDQDVmAJBNQoA1TIRw/wfWu0wAkA1CgDV2p4YC0hKJoYKQC+mQFCNAkC1mfxIMBdfl/N3Pt/0/Rg0X8zX7/zGcQAPzt/5bLN63dLcxQM+HotmM/47qO9SF34ZXe/7sam7LDECOHNuTPDrLDMaOMEawNGlTfhFirL4f9ypX8zS3EVGgAGdu/1pq+DXWZ6/xGgwEAowEBvBL6MEwzBLc5cogGXnbh+zGv6y5fkNimCRWaYA1qwPGPyqFYpgBUeCLXEZfh/3lypGgJ5CCCKjQXdmeW6DAnSwfvsT78EvW5m/TAk6MMvzFKCt9Vthhb9sZYEitEEBWgg5+GWUoDmzMn+ZAjRw9tbHUYS/bHXhCkWYggJMEWPwqyjCeBRgjBSCX0YJ6lGAGqmFv4wivMyszF+hACNnb32UbPDLVheuUoIRCjCiJfxlFEHErC7oLsCZm/qCX7a2qLsEZnXhqtoCnLn5oerwl60tXlNZBJUFIPj1NJZAVQEIfjOaiqCmAIS/PQ1FMKsL15IuwJmbHxD8HtYWryddgqQLQPjtSbUIZi3BApwm+IM4kWAJzNri9WQKcPqv9wm+AyeO/J5MEZL5TDDhdyel33U0I8DD//6pvf7C3ePJbIwYfXX419rR4PV9b7p+KJ1EUQDCH766IsRQgii/KZ7gh+fC3eObr5Yg/GxF9SV5kQR/v+Rb/qGIPBORXSIyKyJbIvJ0dJviusLT0b/vFZE9lZ+3Pfo5dbcPSrF9iiLEkK1oFsGRhD+TfLvviMjuBrffEpFNeRHmR6O/P5A89M9E5MmE2wcpkm0lIhF8S+RPfx6N5pcpeeifSh7c3ZIHepLiVf2x5K/0hdckf3HakrxM024fnKIE37x7I+hdpkGPAJGF30g+AjwZXYzkU51Jilf0cpj3jH7OtryYMk26fdBC34aZ7wdQJ/Rf2hjF73Jv6brdkr9aN7Vr9P8ft/x/QSu2Z4ijgTlx5I/gd4M+2Lo39t8Cmm8W05Nifr5X8gJsi8i+0u2eja6brVz3UPKpT3Xt8EjykaDu9l6NOwZQ2D97yNVD6SwzUazVo1BdmD6SF2uAupLWXbct46c3oRS9sRiyFfQaoHBg9i3fDwEtxbLNglwD1InlF6pJCtskyiPBCEX82ckSeA7wJYHsRLEGAIYS1XuBurh/b2fqvucfv/hXRES+/fmNibc7eMhEsSfG1XNOITsJfFP8eE2C0IbtnzcEt8/Z97bvf2EKBNUoAFRjNyh6iD87jABQLQv84wAIWArZieatEF0Uu/ps3v7UxsGuD8cJjc+5D9YA6CH+7CQ9Akw7yFNoelAoBhqfcx8sgqEaUyD0EH92GAGgGrtB0VkK2WEEgGpJvxvU9tuXY3g7tNvn7Hvb978kvRtUpFkgUjvQo/E5d5V8AVz5/th9Z58VOLVxMPiRKBZJT4FccRl+H/c3nu9tb2EKFEaEEKMUssNeIKjGaVHQXQLZ4a0Q6CH+7DAFgmoUAKpxenR0lkJ2GAGgGgWAahQAqgX/NakIWALZYQSAarwXCJ2lkB2OBAeqfLqStie7cif+7DAFClD1XD3az90zJAoQoOorfrgjQPz4RFigCL0b7AZFdwlkh71A6CyF7LAGgGrsBkUP8WeHEQCqUQCoRgGgGmsA9BB/djg9OjpLITtMgaAaUyD0EH92GAGgGgWAahQAqs0YiftPCFx/YUUoX5Dhe9tb+XPyvb93fP8i+/rhxuEgAqHJd0fvBvIlHf2Yk0fjLwDQFbtBoRqLYKhGAaAaH4mEaqwBoBpTIKjGt0RCNaZAUI0pEFRjLxBUYwSAaqwBoBojAFSjAFCN06NDNfYCQTWmQFBtRtgNBL0Mu0GhGlMgqEYBoFoxBTIiwtkhoIkR4fToUI4pEFSjAFCtvBuUdQC0eB56RgCoVi0AS2Kk7qWMZ6GcYhzwoe60KKwFkKpX0s4aAKqNKwDzIqSmNtO8GxSqTZoC0QykYmyWp30kkgUxYjcx4k2mQJQAsZoabvYCQbWmp0dnFEBsGiW7zQjAohixaJzVtrtBGQkQulaB7nJiLEqAULWOc9dFMNMhhKZTJvscCWYkQCg6hzizdMcUAT70nonYOg7AlAiuWcmcza9JZUoEV6yl1vYnwpgSYUjWZxp91wDjUATYNNgUe6gCFCgC+hh8benqAzEUAW0426ky9AhQVX1iFAIiHvciui5AFYXQKZjd5v8D/FDU2OZRaPEAAAAASUVORK5CYII=';

const _LOGIN_MAX_INTENTOS = 3;
const _LOGIN_BLOQUEO_MS   = 5 * 60 * 1000; // 5 minutos
let _loginIntervalo = null;

function _registrarIntento() {
  const n = parseInt(localStorage.getItem('aleze_intentos') || '0') + 1;
  localStorage.setItem('aleze_intentos', n);
  if (n >= _LOGIN_MAX_INTENTOS) {
    const hasta = Date.now() + _LOGIN_BLOQUEO_MS;
    localStorage.setItem('aleze_bloqueo', hasta);
    localStorage.removeItem('aleze_intentos');
    return true; // bloqueado ahora
  }
  return false;
}

function _limpiarBloqueo() {
  localStorage.removeItem('aleze_bloqueo');
  localStorage.removeItem('aleze_intentos');
}

function _mostrarBloqueo(hasta) {
  const errEl = document.getElementById('login-error');
  const btnEl = document.querySelector('.btn-login');
  if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '0.5'; }
  // Mostrar botón de desbloqueo de emergencia (solo cuando está activo el bloqueo)
  let resetBtn = document.getElementById('btn-reset-bloqueo');
  if (!resetBtn) {
    resetBtn = document.createElement('button');
    resetBtn.id = 'btn-reset-bloqueo';
    resetBtn.type = 'button';
    resetBtn.textContent = '🔓 Desbloquear acceso';
    resetBtn.style.cssText = 'margin-top:0.5rem;font-size:0.75rem;color:var(--gray-500);background:none;border:none;cursor:pointer;text-decoration:underline;width:100%';
    resetBtn.onclick = function() {
      _limpiarBloqueo();
      if (_loginIntervalo) { clearInterval(_loginIntervalo); _loginIntervalo = null; }
      if (errEl) { errEl.style.display = 'none'; }
      if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = ''; }
      resetBtn.remove();
    };
    if (btnEl) btnEl.insertAdjacentElement('afterend', resetBtn);
  }
  if (_loginIntervalo) clearInterval(_loginIntervalo);
  _loginIntervalo = setInterval(() => {
    const restante = Math.max(0, hasta - Date.now());
    const min = Math.floor(restante / 60000);
    const seg = Math.floor((restante % 60000) / 1000);
    if (errEl) {
      errEl.style.display = 'block';
      errEl.style.color = 'var(--danger)';
      errEl.textContent = `⛔ Demasiados intentos. Espera ${min}:${seg.toString().padStart(2,'0')} para volver a intentar.`;
    }
    if (restante <= 0) {
      clearInterval(_loginIntervalo);
      _limpiarBloqueo();
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = 'Contraseña incorrecta'; }
      if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = ''; }
      const rb = document.getElementById('btn-reset-bloqueo');
      if (rb) rb.remove();
    }
  }, 500);
}
// ── Flujo Welcome → Login ─────────────────────────────────────
function volverWelcome() {
  document.getElementById('login-welcome').style.display = 'block';
  document.getElementById('login-form-panel').style.display = 'none';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-pass').value = '';
}
// NOTA: se evaluó un mecanismo de restauración de sesión offline (onAuthStateChanged) que
// permitía entrar sin volver a pedir contraseña si el dispositivo ya tenía una sesión guardada.
// Se descartó a propósito por riesgo de seguridad real: en un sistema con varios cajeros y
// dispositivos que pueden quedar accesibles a terceros, entrar sin ninguna barrera (con o sin
// señal, indefinidamente hasta un cierre de sesión explícito) pesa más que la comodidad de no
// re-tipear la contraseña. La app sigue funcionando sin señal una vez con la sesión ya activa en
// memoria (ver Promise.allSettled en _completarSesion) — la única limitación real que queda es
// que si la app se cierra por completo estando sin señal desde el arranque, hay que esperar
// señal para volver a entrar. Esa limitación se acepta a cambio de la seguridad.

async function doLogin() {
  // ── PASO 0: Reset total de estado anterior (sesión previa, cambio de usuario) ──
  resetAppState();

  // ── PASO 1: Bloqueo local por intentos fallidos ──
  const bloqueoTs = parseInt(localStorage.getItem('aleze_bloqueo') || '0');
  if (bloqueoTs > Date.now()) { _mostrarBloqueo(bloqueoTs); return; }

  const sel   = document.getElementById('login-user').value;
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btnEl = document.querySelector('.btn-login');
  if (errEl) errEl.style.display = 'none';

  if (!sel || !pass) {
    if (errEl) { errEl.style.display='block'; errEl.style.color='var(--danger)'; errEl.textContent='Selecciona usuario e ingresa contraseña'; }
    return;
  }

  const [name, role] = sel.split('|');
  const _usuarioStaff = (DB.config.usuariosStaff || []).find(u => u.nombre === name);
  const email = _usuarioStaff ? _usuarioStaff.email : null;
  if (!email) {
    if (errEl) { errEl.style.display='block'; errEl.style.color='var(--danger)'; errEl.textContent='Usuario no configurado'; }
    return;
  }

  // ── PASO 1.5: Verificar versión ──
  try {
    const verSnap = await getDocM(docM(dbModular, 'aleze', 'version')); // [SDK modular]
    if (verSnap.exists()) { // en modular, exists es un METODO, no una propiedad
      const requerida = verSnap.data().minVersion || '1.0.0';
      if (APP_VERSION < requerida) {
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; }
        if (errEl) { errEl.style.display='block'; errEl.style.color='var(--danger)'; errEl.textContent='⚠️ Versión desactualizada. Cierra y vuelve a abrir la app para actualizar.'; }
        return;
      }
    }
  } catch(e) {}
  // ── PASO 2: Firebase Auth — única fuente de verdad ──
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Verificando...'; }

  try {
    await fbAuth.signInWithEmailAndPassword(email, pass);
    _limpiarBloqueo();
  } catch(fbErr) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; }
    document.getElementById('login-pass').value = '';

    let msg = 'Error de acceso. Intenta de nuevo.';
    if (fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/invalid-credential') {
      const bloqueado = _registrarIntento();
      if (bloqueado) {
        _mostrarBloqueo(parseInt(localStorage.getItem('aleze_bloqueo')));
        return;
      }
      const restantes = _LOGIN_MAX_INTENTOS - parseInt(localStorage.getItem('aleze_intentos') || '0');
      msg = `Contraseña incorrecta. ${restantes} intento(s) restante(s).`;
    } else if (fbErr.code === 'auth/too-many-requests') {
      msg = '⚠️ Demasiados intentos. Espera unos minutos.';
    } else if (fbErr.code === 'auth/network-request-failed') {
      msg = '⚠️ Sin conexión a internet. Verifica tu red.';
    } else if (fbErr.code === 'auth/user-not-found') {
      msg = 'Usuario no encontrado en Firebase. Contacta al administrador.';
    }

    if (errEl) { errEl.style.display='block'; errEl.style.color='var(--danger)'; errEl.textContent=msg; }
    return;
  }

  await _completarSesion(name, role);
}

// ── Todo lo que pasa DESPUES de una autenticacion valida (signInWithEmailAndPassword, arriba)
// — separado de doLogin() para mantener el codigo mas ordenado: aca vive la carga de datos, el
// render de la app y el arranque de los listeners.
async function _completarSesion(name, role) {
  const btnEl = document.querySelector('.btn-login');
  const errEl = document.getElementById('login-error');
  const sel = `${name}|${role}`;

  // ── PASO 3: Cargar datos desde Firebase ANTES de cualquier render ──
  if (btnEl) { btnEl.textContent = '⏳ Cargando datos...'; }

  if (fbFS) {
    try {
      // CRITICO: las 14 lecturas de esta seccion son completamente independientes entre si en
      // terminos de RED — ninguna necesita el RESULTADO de otra para saber que pedir. Antes
      // corrian en 5 tandas secuenciales (una esperaba a que la anterior terminara antes de
      // arrancar) — en wifi esto no se notaba (milisegundos), pero en una red movil con mas
      // latencia por viaje, 5 saltos secuenciales se acumulan hasta hacerse notar (reportado:
      // ~20 segundos). Ahora se piden TODAS a la vez con Promise.allSettled — nunca se cae
      // entera si UNA falla (a diferencia de Promise.all), asi que si por ejemplo gastos da
      // permission-denied un instante, las otras 13 igual se aplican, mismo comportamiento de
      // resiliencia que los try/catch separados de antes, ahora en un solo viaje de red. Los
      // resultados se APLICAN despues en el mismo orden logico de siempre (config -> caja ->
      // productos -> stock -> reconciliacion -> ext -> gastos) — aplicar en memoria no tiene
      // costo de red, solo el PEDIDO lo tenia.
      const _limiteReconcilia = new Date(Date.now() - 40*24*60*60*1000).toISOString().slice(0,10);
      const _resultados = await Promise.allSettled([
        getDocM(docM(dbModular, 'aleze', 'db_productos')),                                          // 0
        getDocM(docM(dbModular, 'aleze', 'db_ext')),                                                 // 1
        getDocM(docM(dbModular, 'aleze', 'config')),                                                 // 2
        getDocsM(collectionM(dbModular, 'caja')),                                                    // 3
        getDocsM(collectionM(dbModular, 'stock')),                                                   // 4
        getDocsM(queryM(collectionM(dbModular, 'ventas'), whereM('fecha', '>=', _limiteReconcilia))),// 5
        getDocsM(collectionM(dbModular, 'fiados')),        // fiados: todos, nunca deberia faltar    // 6
        getDocsM(collectionM(dbModular, 'clientes')),      // clientes: todos, nunca deberia faltar  // 7
        getDocsM(collectionM(dbModular, 'mermas')),        // mermas: todas, nunca deberia faltar — bajo volumen (pocas por mes), igual criterio que fiados/clientes. Antes tenia limite de 40 dias, lo que dejaba mermas viejas PERDIDAS PARA SIEMPRE si alguna vez faltaron localmente — ningun relogin las recuperaba, la propia consulta las excluia de raiz.
        getDocsM(queryM(collectionM(dbModular, 'movimientos'), whereM('fecha', '>=', _limiteReconcilia))), // 9
        getDocsM(collectionM(dbModular, 'promociones')),                                             // 10
        getDocsM(collectionM(dbModular, 'proveedores')),                                             // 11
        getDocsM(collectionM(dbModular, 'boletas')),                                                 // 12
        getDocsM(queryM(collectionM(dbModular, 'gastos'), whereM('fecha', '>=', _limiteReconcilia))),  // 13
        getDocsM(collectionM(dbModular, 'capital_movimientos')) // capital: todo, nunca deberia faltar — bajo volumen (aportes/pagos no son frecuentes), mismo criterio que fiados/clientes/mermas — 14
      ]);
      // CRITICO: antes, si una de estas 15 lecturas fallaba, solo se veia un aviso generico
      // ("no se pudo reconciliar X") sin la razon real del error (permission-denied? red
      // caida? App Check bloqueado?) — imposible diagnosticar con certeza cuando pasaba. Ahora
      // se registra el codigo y mensaje real de CADA fallo, identificado por nombre.
      const _nombresLectura = ['db_productos','db_ext','config','caja','stock','ventas','fiados',
        'clientes','mermas','movimientos','promociones','proveedores','boletas','gastos','capital_movimientos'];
      const _ok = i => {
        if (_resultados[i].status === 'fulfilled') return _resultados[i].value;
        const _razon = _resultados[i].reason;
        console.warn(`[Offline] Fallo la lectura de '${_nombresLectura[i]}' — código: ${_razon?.code || 'desconocido'}, mensaje: ${_razon?.message || _razon}`);
        return null;
      };
      const snapProd = _ok(0), snapExt = _ok(1), snapConfig = _ok(2), cajaSnap = _ok(3), stockSnap = _ok(4),
            ventasSnap = _ok(5), fiadosSnap = _ok(6), clientesSnap = _ok(7), mermasSnap = _ok(8),
            movimientosSnap = _ok(9), promocionesSnap = _ok(10), proveedoresSnap = _ok(11),
            boletasSnap = _ok(12), gastosSnap = _ok(13), capitalMovSnap = _ok(14);

      // config: documento propio, ya no es parte de aleze/db (mismo criterio que caja).
      if (snapConfig && snapConfig.exists()) { // en modular, exists es un METODO, no una propiedad
        DB.config = { ...DB.config, ...snapConfig.data() };
      }
      // Trae la caja real desde su colección dedicada — única fuente de verdad.
      if (cajaSnap) {
        cajaSnap.forEach(doc => { DB._cajas[doc.id] = doc.data(); });
      } else { console.warn('[Offline] No se pudo reconciliar caja fresca'); }

      if (snapProd && snapProd.exists()) { // en modular, exists es un METODO, no una propiedad
        const pd = snapProd.data();
        if (pd.productos)  DB.productos  = pd.productos;
        if (pd.categorias) DB.categorias = pd.categorias;
        if (pd.config)     DB.config     = { ...DB.config, ...pd.config };
        _fbProdCacheTs = Date.now();
      }
      // Fase Offline: trae el stock más fresco (colección aparte, puede tener cambios más recientes
      // que el snapshot de arriba si otra sede vendió/ajustó mientras este dispositivo no estaba conectado).
      if (stockSnap) {
        stockSnap.forEach(doc => {
          const prod = DB.productos.find(p => String(p.id) === doc.id);
          const d = doc.data();
          if (prod && d && d.stockPorSede) {
            prod.stockPorSede = d.stockPorSede;
            prod.stock = stockTotal(prod);
          }
        });
      } else { console.warn('[Offline] No se pudo reconciliar stock fresco'); }

      // CRITICO — corrige la causa raiz de perdida real de datos: TODO lo que camposOp carga
      // desde el documento combinado (ventas, clientes, fiados, mermas, movimientos) puede
      // quedar viejo si otra sesion con datos desactualizados guarda encima. Caja y stock ya
      // tenian esta reconciliacion desde su propia coleccion — ahora las 5 restantes tambien.
      // Esto es lo que causo el incidente real de clientes desaparecidos (ventas quedando
      // "Anónimo" porque el cliente referenciado ya no estaba en la lista). Nunca borra nada,
      // solo agrega lo que el documento combinado no tenga.
      // CRITICO: antes, TODAS las 8 colecciones (ventas/fiados/clientes/mermas/movimientos/
      // promociones/proveedores/boletas) tenian que leerse con exito para que CUALQUIERA se
      // reconciliara — si una sola fallaba (proveedores, boletas, cualquiera), NINGUNA se
      // reconciliaba, ni siquiera clientes, aunque su propia lectura hubiera sido exitosa.
      // Esto podia dejar clientes creados en otro dispositivo invisibles en este, sin ningun
      // error visible que lo explicara. Ahora cada coleccion se reconcilia de forma
      // independiente segun su propio resultado, sin depender de las demas.
      if (!DB.historialVentas) DB.historialVentas = [];
      if (!DB.fiados) DB.fiados = [];
      if (!DB.clientes) DB.clientes = [];
      if (!DB.mermas) DB.mermas = [];
      if (!DB.movimientos) DB.movimientos = [];
      if (!DB.promociones) DB.promociones = [];
      if (!DB.proveedores) DB.proveedores = [];

      const _reconciliar = (snap, arr, idKey) => {
        if (!snap) return 0;
        const ids = new Set(arr.map(x => String(x[idKey])));
        let n = 0;
        snap.forEach(doc => { if (!ids.has(doc.id)) { arr.push(doc.data()); n++; } });
        return n;
      };
      const _rVentas    = _reconciliar(ventasSnap, DB.historialVentas, 'id');
      const _rFiados    = _reconciliar(fiadosSnap, DB.fiados, 'id');
      const _rClientes  = _reconciliar(clientesSnap, DB.clientes, 'id');
      const _rMermas    = _reconciliar(mermasSnap, DB.mermas, 'id');
      const _rMovs      = _reconciliar(movimientosSnap, DB.movimientos, 'id');
      const _rPromos    = _reconciliar(promocionesSnap, DB.promociones, 'id');
      const _rProvs     = _reconciliar(proveedoresSnap, DB.proveedores, 'id');
      _envolverTodosClientes(); // los clientes recien agregados tambien necesitan su Proxy

      // boletas: reconstruye la relacion boleta->proveedor en memoria, asi que necesita AMBAS
      // lecturas (no es un "todo o nada" con las otras 6 — es un caso legitimo de dependencia
      // real entre 2 colecciones especificas, no una dependencia accidental como la de antes).
      if (boletasSnap && proveedoresSnap) {
        const _boletasPorProveedor = {};
        boletasSnap.forEach(doc => {
          const b = doc.data();
          const pid = b.proveedorId;
          if (pid == null) return;
          if (!_boletasPorProveedor[pid]) _boletasPorProveedor[pid] = [];
          _boletasPorProveedor[pid].push(b);
        });
        DB.proveedores.forEach(p => { p.boletas = _boletasPorProveedor[p.id] || []; });
      } else {
        console.warn('[Offline] No se pudo reconciliar boletas (falta la lectura de boletas o de proveedores)');
      }

      const _totalReconciliado = _rVentas + _rFiados + _rClientes + _rMermas + _rMovs + _rPromos + _rProvs;
      if (_totalReconciliado) {
        console.warn(`[Reconciliación] Recuperados: ${_rVentas} venta(s), ${_rFiados} fiado(s), ${_rClientes} cliente(s), ${_rMermas} merma(s), ${_rMovs} movimiento(s), ${_rPromos} promocion(es), ${_rProvs} proveedor(es) que faltaban en el documento combinado.`);
      }
      [['ventas',ventasSnap],['fiados',fiadosSnap],['clientes',clientesSnap],['mermas',mermasSnap],
       ['movimientos',movimientosSnap],['promociones',promocionesSnap],['proveedores',proveedoresSnap]]
        .filter(([,snap]) => !snap).forEach(([nombre]) => console.warn(`[Offline] No se pudo reconciliar ${nombre} frescos`));

      aplicarNombreNegocio();

      if (snapExt && snapExt.exists()) { // en modular, exists es un METODO, no una propiedad
        const ext = snapExt.data();
        // Mismo criterio que el listener en tiempo real de db_ext (ver firebase-sync.js):
        // 'gastos' y 'capital' se excluyen del reemplazo ciego — gastos tiene su propia
        // colección real, y capital.total/recuperado/prestamoPagado son getters calculados,
        // reemplazar el objeto entero los borraría.
        Object.keys(ext).forEach(k => {
          if (k === 'gastos') return;
          if (k === 'capital') {
            if (ext.capital) ['prestamo','cuota','meta'].forEach(campo => {
              if (ext.capital[campo] != null) DB_EXT.capital[campo] = ext.capital[campo];
            });
            return;
          }
          if (k in DB_EXT) DB_EXT[k] = ext[k];
        });
        // Migración defensiva, una sola vez: historial viejo de capital que todavía viva
        // dentro de db_ext (de antes de esta separación) se migra a su colección real.
        if (ext.capital && Array.isArray(ext.capital.hist) && ext.capital.hist.length && !DB.capitalMovimientos.length) {
          try { if (typeof _migrarCapitalHistSiHaceFalta === 'function') _migrarCapitalHistSiHaceFalta(ext.capital.hist); } catch(e){}
        }
      }
      // Mismo criterio que ventas/fiados/clientes/mermas/movimientos — gastos vive en un
      // documento separado (db_ext) pero tiene exactamente el mismo riesgo de quedar viejo.
      if (gastosSnap) {
        if (!DB_EXT.gastos) DB_EXT.gastos = [];
        const _idsGastos = new Set(DB_EXT.gastos.map(g => String(g.id)));
        let _rGastos = 0;
        gastosSnap.forEach(doc => { if (!_idsGastos.has(doc.id)) { DB_EXT.gastos.push(doc.data()); _rGastos++; } });
        if (_rGastos) console.warn(`[Reconciliación] Recuperados ${_rGastos} gasto(s) que faltaban en el documento combinado.`);
      } else { console.warn('[Offline] No se pudo reconciliar gastos frescos'); }
      // capital: todo, nunca deberia faltar — bajo volumen, mismo criterio que fiados/clientes.
      if (capitalMovSnap) {
        if (!DB.capitalMovimientos) DB.capitalMovimientos = [];
        const _idsCapMov = new Set(DB.capitalMovimientos.map(m => String(m.id)));
        let _rCapMov = 0;
        capitalMovSnap.forEach(doc => { if (!_idsCapMov.has(doc.id)) { DB.capitalMovimientos.push(doc.data()); _rCapMov++; } });
        if (_rCapMov) console.warn(`[Reconciliación] Recuperados ${_rCapMov} movimiento(s) de capital que faltaban.`);
      } else { console.warn('[Offline] No se pudo reconciliar movimientos de capital frescos'); }
    } catch(e) {
      console.warn('Error cargando datos en login, continuando con caché local:', e.message);
    }
  }

  fbPatchDB();
  renderLoginDropdown();
  // ── PASO 4: Estado de sesión — ahora que los datos están listos ──
  if (_loginIntervalo) { clearInterval(_loginIntervalo); _loginIntervalo = null; }
  if (errEl) errEl.style.display = 'none';
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Ingresar'; btnEl.style.opacity = ''; }

  currentUser = name;
currentRole = role;
  const _staffLogin = (DB.config.usuariosStaff || []).find(u => u.nombre === name);
  currentUserSedeId = (_staffLogin && _staffLogin.sedeId) || 'principal';
  localStorage.setItem('aleze_last_user', sel);

  // ── PASO 5: Mostrar UI — solo después de tener datos ──
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  try { hideSplash(); } catch(e) {}
  document.getElementById('header-username').textContent = name;
  document.getElementById('header-avatar').textContent = name.substring(0,2).toUpperCase();
  document.getElementById('header-role').textContent = role === 'admin' ? '(Admin)' : '(Cajero)';

  // Sede administrativa: solo admin la ve — sede 2 no tiene admin propio, así que el admin
  // necesita poder operar (boletas, mermas, productos nuevos, gastos, caja) para cualquier sede.
  const _selSedeAdmin = document.getElementById('sede-admin-selector');
  const _barraSede = document.getElementById('sede-context-bar');
  if (_selSedeAdmin && _barraSede) {
    if (role === 'admin') {
      // Etiqueta corta — el selector no entraba en el header movil sin forzar scroll.
      // El value interno (principal / Tienda Aleze II) no cambia, solo lo que se ve.
      const _sedeCorta = s => s === 'principal' ? 'Sede I' : 'Sede II';
      const _miSede = currentUserSedeId || 'principal';
      const _otrasSedes = ['principal', 'Tienda Aleze II'].filter(s => s !== _miSede);
      _selSedeAdmin.innerHTML = `<option value="">${_sedeCorta(_miSede)}</option>` +
        _otrasSedes.map(s => `<option value="${s}">${_sedeCorta(s)}</option>`).join('');
      _barraSede.style.display = 'flex';
      // El sidebar y el alto del contenido dependen de --header-h — si la barra de sede se
      // suma arriba, hay que avisarle a ese cálculo o el sidebar queda mal posicionado.
      document.documentElement.style.setProperty('--header-h', '70px');
    } else {
      _barraSede.style.display = 'none';
      document.documentElement.style.setProperty('--header-h', '46px');
    }
  }

  if (role !== 'admin') {
    document.getElementById('admin-nav').style.display = 'none';
    navigate('pos');
  } else {
    // Resolver shortcut PWA si viene de #pos
    if (window.__pendingRoute === 'pos') {
      window.__pendingRoute = null;
      navigate('pos');
    } else {
      renderDashboard();
    }
  }
  updateAlertCount();

  // ── PASO 6: Listener en tiempo real (DESPUÉS del render inicial) ──
  fbEscuchar();
  fbEscucharPedidosOnline();
  fbEscucharCaja();
  _iniciarListenersOperativos();
  _programarChequeoMedianoche();
  if (currentRole === 'admin') iniciarBackupAutomatico();
  _registrarNotificacionesPush();
}

// ── Notificaciones push reales (FCM) — avisa aunque la app este cerrada o el celular
// bloqueado, a diferencia de notificarNuevoPedido() que solo funciona con la pestaña abierta.
// Dormido hasta que VAPID_KEY tenga la clave real (ver comentario junto a esa constante).
async function _registrarNotificacionesPush() {
  if (VAPID_KEY === 'PENDIENTE') return; // no configurado todavia, no hace nada
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !firebase.messaging) return;
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') { console.log('[FCM] Notificaciones no autorizadas por el usuario.'); return; }

    const reg = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) { console.warn('[FCM] No se pudo obtener el token del dispositivo.'); return; }

    // El token ES el id del documento — asi un mismo dispositivo nunca duplica su registro,
    // y si el usuario cambia (otro cajero entra con el mismo celular) el token se actualiza solo.
    await setDocM(docM(dbModular, 'staff_tokens', token), { // [SDK modular]
      usuario: currentUser || 'desconocido',
      sedeId: currentUserSedeId || 'principal',
      ultimaActividad: serverTimestampM()
    }, { merge: true });
    console.log('[FCM] Dispositivo registrado para notificaciones push.');
  } catch (e) {
    console.warn('[FCM] No se pudo registrar el dispositivo para notificaciones push:', e.message);
  }
}
let _logoutEsperando = 0;
function doLogout() {
  // ── PASO -1: Si hay un guardado pendiente (fbSaveTimer o escritura en curso), esperar ──
  // Protección extra: si algo deja esta bandera trabada (como el bug real que se encontró y
  // corrigió en guardarPromocion), no se espera en silencio para siempre — después de ~6
  // segundos se avisa y se sale igual, en vez de que el botón "no haga nada" sin explicación.
  if (_fbEscribiendo || _fbSaveTimer) {
    _logoutEsperando += 200;
    if (_logoutEsperando > 6000) {
      _logoutEsperando = 0;
      console.warn('doLogout: guardado pendiente no se resolvió a tiempo, saliendo de todas formas');
    } else {
      setTimeout(doLogout, 200);
      return;
    }
  } else {
    _logoutEsperando = 0;
  }
  // ── PASO 0: Reset total — ningún estado de sesión persiste ──
  resetAppState();

  // Detener listeners en tiempo real
  if (_backupTimer) { clearInterval(_backupTimer); _backupTimer = null; }
  if (_pedidosOnlineUnsub) { _pedidosOnlineUnsub(); _pedidosOnlineUnsub = null; }
  if (_fbSnapshotUnsub)    { _fbSnapshotUnsub();    _fbSnapshotUnsub    = null; }

  // Cerrar sesión Firebase en segundo plano
  if (fbAuth) fbAuth.signOut().catch(() => {});

  // Volver a pantalla de login
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('app').classList.remove('visible');
    document.getElementById('login-pass').value = '';
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.style.display = 'none';
    volverWelcome();

  // Restaurar bloqueo si sigue activo
  const bloqueoTs = parseInt(localStorage.getItem('aleze_bloqueo') || '0');
  if (bloqueoTs > Date.now()) _mostrarBloqueo(bloqueoTs);
}

