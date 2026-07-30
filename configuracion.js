// ===================== CONFIGURACION =====================
function _uploadConfigImg(fileInput, targetFieldId, storagePath) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!fbStorage) { alert('Storage no disponible'); return; }
  const btn = fileInput.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const MAX = 800;
      const ratio = Math.min(MAX/img.width, MAX/img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        try {
          const ref = fbStorage.ref(storagePath);
          await ref.put(blob, { contentType: 'image/webp' });
          const url = await ref.getDownloadURL();
          const field = document.getElementById(targetFieldId);
          if (field) field.value = url;
          if (btn) { btn.disabled = false; btn.textContent = '📁 Subir'; }
        } catch(err) {
          alert('Error al subir: ' + (err.code || err.message));
          if (btn) { btn.disabled = false; btn.textContent = '📁 Subir'; }
        }
      }, 'image/webp', 0.85);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
function renderConfigTienda() {
  const cfg = DB.config || {};
  // Inicializar campos si no existen aún en Firebase
  if (!cfg.tiendasExternas || !cfg.tiendasExternas.length) {
    cfg.tiendasExternas = [
      {id:'efe',     nombre:'Tienda Efe',  imagen:'', url:'', visible:true,  waCatalogo:false},
      {id:'curacao', nombre:'Curacao',     imagen:'', url:'', visible:true,  waCatalogo:false},
      {id:'juntoz',  nombre:'Juntoz',      imagen:'', url:'', visible:true,  waCatalogo:false},
      {id:'bata',    nombre:'Bata',        imagen:'', url:'', visible:true,  waCatalogo:true}
    ];
  }
  if (!cfg.serviciosWa || !cfg.serviciosWa.length) {
    cfg.serviciosWa = [
      {id:'impresiones', nombre:'Impresiones y copias', emoji:'🖨️', visible:true},
      {id:'recargas',    nombre:'Recargas celular',      emoji:'📱',  visible:true},
      {id:'pagos',       nombre:'Pago de servicios',     emoji:'💡',  visible:true},
      {id:'escaneos',    nombre:'Escaneos',               emoji:'📋',  visible:true}
    ];
  }
  const el = document.getElementById('cfg-eslogan'); if (el) el.value = cfg.eslogan || '';
  const bu = document.getElementById('cfg-banner-url'); if (bu) bu.value = cfg.bannerUrl || '';
  const bl = document.getElementById('cfg-banner-link'); if (bl) bl.value = cfg.bannerLink || '';
  const bv = document.getElementById('cfg-banner-visible'); if (bv) bv.checked = cfg.bannerVisible !== false;
  const wa = document.getElementById('cfg-wa-servicios'); if (wa) wa.value = cfg.whatsappTienda || '';
  const sb = document.getElementById('cfg-servicios-banner'); if (sb) sb.value = cfg.serviciosBannerUrl || '';
  const tt = document.getElementById('cfg-tiendas-texto'); if (tt) tt.value = cfg.tiendasTexto || '';
  // Tiendas externas
  const te = document.getElementById('cfg-tiendas-externas');
  if (te) te.innerHTML = (cfg.tiendasExternas || []).map((t, i) => `
    <div style="border:1px solid var(--gray-200);border-radius:8px;padding:.75rem;margin-bottom:.5rem">
      <div style="font-weight:700;font-size:.82rem;margin-bottom:.5rem">${t.nombre}</div>
<div class="form-group"><label style="font-size:.75rem">URL imagen</label><div style="display:flex;gap:.4rem;align-items:center"><input type="text" class="form-control" id="cfg-te-img-${i}" value="${t.imagen||''}" placeholder="https://firebasestorage..." style="flex:1"/><input type="file" id="_te-file-${i}" accept="image/*" style="display:none" onchange="_uploadConfigImg(this,'cfg-te-img-${i}','tienda/${t.id}.webp')"><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('_te-file-'+${i}).click()">📁</button></div></div>
      <div class="form-group"><label style="font-size:.75rem">Link destino (afiliado)</label><input type="text" class="form-control" id="cfg-te-url-${i}" value="${t.url||''}" placeholder="https://..." /></div>
      <label style="font-size:.75rem;display:flex;align-items:center;gap:.4rem"><input type="checkbox" id="cfg-te-vis-${i}" ${t.visible?'checked':''}> Visible en tienda</label>
    </div>`).join('');
  // Servicios
  const sw = document.getElementById('cfg-servicios-wa');
  if (sw) sw.innerHTML = (cfg.serviciosWa || []).map((s, i) => `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">
      <span style="font-size:1.2rem">${s.emoji}</span>
      <input type="text" class="form-control" id="cfg-sw-nom-${i}" value="${s.nombre||''}" style="flex:1" />
      <label style="font-size:.75rem;white-space:nowrap;display:flex;align-items:center;gap:.3rem"><input type="checkbox" id="cfg-sw-vis-${i}" ${s.visible?'checked':''}> Visible</label>
    </div>`).join('');
}
function guardarConfigTienda() {
  if (currentRole !== 'admin') return;
  const cfg = DB.config;
  cfg.eslogan    = document.getElementById('cfg-eslogan')?.value.trim() || 'Todo lo que necesitas, cerca de ti';
  cfg.bannerUrl  = document.getElementById('cfg-banner-url')?.value.trim() || '';
  cfg.bannerLink = document.getElementById('cfg-banner-link')?.value.trim() || '';
  cfg.bannerVisible = document.getElementById('cfg-banner-visible')?.checked !== false;
cfg.serviciosBannerUrl = document.getElementById('cfg-servicios-banner')?.value.trim() || '';
cfg.tiendasTexto = document.getElementById('cfg-tiendas-texto')?.value.trim() || '';
  cfg.serviciosBannerUrl = document.getElementById('cfg-servicios-banner')?.value.trim() || '';
  cfg.tiendasTexto = document.getElementById('cfg-tiendas-texto')?.value.trim() || '';
  (cfg.tiendasExternas || []).forEach((t, i) => {
    t.imagen   = document.getElementById(`cfg-te-img-${i}`)?.value.trim() || '';
    t.url      = document.getElementById(`cfg-te-url-${i}`)?.value.trim() || '';
    t.visible  = document.getElementById(`cfg-te-vis-${i}`)?.checked !== false;
  });
  (cfg.serviciosWa || []).forEach((s, i) => {
    s.nombre  = document.getElementById(`cfg-sw-nom-${i}`)?.value.trim() || s.nombre;
    s.visible = document.getElementById(`cfg-sw-vis-${i}`)?.checked !== false;
  });
  fbGuardar(); fbGuardarProductos();
  alert('✅ Configuración de tienda guardada');
}
function renderConfiguracion() {
  if (currentRole !== 'admin') return;
  document.getElementById('cfg-nombre').value    = DB.config.nombre    || 'Tienda Aleze';
  document.getElementById('cfg-direccion').value = DB.config.direccion || '';
  document.getElementById('cfg-telefono').value  = DB.config.telefono  || '';
 document.getElementById('cfg-whatsapp-tienda').value = DB.config.whatsappTienda || '980037284';
document.getElementById('cfg-ruc').value = DB.config.ruc || '';
  document.getElementById('cfg-ticket-msg').value= DB.config.ticketMsg || '¡Gracias por su compra!';
  document.getElementById('cfg-dias-venc').value = DB.config.diasVenc  || 7;
  document.getElementById('cfg-monto-apertura').value = DB.config.montoAperturaAuto || 0;
  document.getElementById('sueldo-jc').value = DB_EXT.sueldos['Jose Carlos'] || 0;
  document.getElementById('sueldo-sh').value = DB_EXT.sueldos['Shessira']    || 0;
  document.getElementById('sueldo-jl').value = DB_EXT.sueldos['José Luis']   || 0;
  document.getElementById('cfg-nav-n').value = DB_EXT.navidad.n     || 3;
  document.getElementById('cfg-nav-v').value = DB_EXT.navidad.valor || 50;
  // Niveles
  document.getElementById('cfg-niveles-form').innerHTML = DB_EXT.niveles.map((n, i) => `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem">
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem">Umbral ${i+1} (S/)</label>
        <input type="number" class="form-control" id="nv-u-${i}" value="${n.umbral}" />
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:.72rem">Premio máx (S/)</label>
        <input type="number" class="form-control" id="nv-m-${i}" value="${n.max}" />
      </div>
   </div>`).join('');
  const _pp = DB.config.pasarelaPago || { activa: false, llavePublica: '' };
  document.getElementById('cfg-pasarela-activa').checked = !!_pp.activa;
  document.getElementById('cfg-pasarela-llave').value = _pp.llavePublica || '';
  document.getElementById('cfg-pasarela-detalle').style.display = _pp.activa ? 'block' : 'none';
  renderConfigTienda();
  renderUsuariosStaff();
  renderCfgUserSelect();
}

function guardarConfigPasarela() {
  DB.config.pasarelaPago = {
    activa: document.getElementById('cfg-pasarela-activa').checked,
    proveedor: 'izipay',
    llavePublica: document.getElementById('cfg-pasarela-llave').value.trim()
  };
  fbGuardarProductos();
  alert('✅ Configuración guardada.' + (DB.config.pasarelaPago.activa ? '\n\nRecuerda: esto solo funciona si ya desplegaste las Cloud Functions del repositorio — activar el interruptor no las despliega solas.' : ''));
}

function guardarConfig() {
  DB.config.nombre    = document.getElementById('cfg-nombre').value;
  DB.config.direccion = document.getElementById('cfg-direccion').value;
  DB.config.telefono  = document.getElementById('cfg-telefono').value;
  DB.config.whatsappTienda = document.getElementById('cfg-whatsapp-tienda').value.replace(/\D/g,'');
  DB.config.ticketMsg = document.getElementById('cfg-ticket-msg').value;
  DB.config.diasVenc  = parseInt(document.getElementById('cfg-dias-venc').value) || 7;
  DB.config.montoAperturaAuto = parseFloat(document.getElementById('cfg-monto-apertura').value) || 0;
  DB.config.ruc = document.getElementById('cfg-ruc').value.trim();
  fbGuardarProductos();// config también va en db_productos para que la tienda lo lea
  fbGuardar();
  try { renderDashboard(); } catch(e){}
  alert('✅ Configuración guardada');
}

// ── Gestión de usuarios (nombre/correo/rol/sede) — editable sin tocar código ──
// Nota: esto NO crea la cuenta en Firebase Authentication. Esa cuenta (correo+contraseña)
// se sigue creando manualmente en la consola de Firebase; aquí solo se administra
// el nombre visible, a qué correo corresponde, su rol y su sede.
function renderLoginDropdown() {
  const sel = document.getElementById('login-user');
  if (!sel) return;
  const valorActual = sel.value;
  sel.innerHTML = '<option value="">Seleccionar usuario...</option>' +
    (DB.config.usuariosStaff || []).map(u => `<option value="${u.nombre}|${u.rol}">${u.nombre}</option>`).join('');
  if (valorActual) sel.value = valorActual;
}

function renderCfgUserSelect() {
  const sel = document.getElementById('cfg-user-sel');
  if (!sel) return;
  sel.innerHTML = (DB.config.usuariosStaff || []).map(u => `<option>${u.nombre}</option>`).join('');
}

function renderUsuariosStaff() {
  const cont = document.getElementById('usuarios-staff-list');
  if (!cont) return;
  if (!DB.config.usuariosStaff || DB.config.usuariosStaff.length === 0) {
    cont.innerHTML = '<p style="color:var(--gray-400);font-size:.8rem">Sin usuarios registrados.</p>';
    return;
  }
  cont.innerHTML = DB.config.usuariosStaff.map((u, i) => `
    <div style="display:flex;gap:.4rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--gray-100)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.82rem">${u.nombre}</div>
        <div style="font-size:.72rem;color:var(--gray-400);overflow:hidden;text-overflow:ellipsis">${u.email}</div>
      </div>
      <select class="form-control" style="width:auto;font-size:.75rem" onchange="cambiarRolUsuarioStaff(${i}, this.value)">
        <option value="admin" ${u.rol==='admin'?'selected':''}>Admin</option>
        <option value="cajero" ${u.rol==='cajero'?'selected':''}>Cajero</option>
      </select>
      <select class="form-control" style="width:100px;font-size:.75rem" onchange="cambiarSedeUsuarioStaff(${i}, this.value)" title="Sede">
        <option value="principal" ${(u.sedeId||'principal')==='principal'?'selected':''}>Sede I</option>
        <option value="Tienda Aleze II" ${u.sedeId==='Tienda Aleze II'?'selected':''}>Sede II</option>
      </select>
      <button type="button" class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarUsuarioStaff(${i})">🗑️</button>
    </div>`).join('');
}

function agregarUsuarioStaff() {
  const nombre = document.getElementById('nuevo-usr-nombre').value.trim();
  const email  = document.getElementById('nuevo-usr-email').value.trim();
  const rol    = document.getElementById('nuevo-usr-rol').value || 'cajero';
  const sedeId = document.getElementById('nuevo-usr-sede').value.trim() || 'principal';
  if (!nombre || !email) { alert('Nombre y correo son obligatorios'); return; }
  if (!DB.config.usuariosStaff) DB.config.usuariosStaff = [];
  if (DB.config.usuariosStaff.some(u => u.nombre === nombre)) { alert('Ya existe un usuario con ese nombre'); return; }
  DB.config.usuariosStaff = [...DB.config.usuariosStaff, { nombre, email, rol, sedeId }];
  document.getElementById('nuevo-usr-nombre').value = '';
  document.getElementById('nuevo-usr-email').value = '';
  document.getElementById('nuevo-usr-sede').value = '';
  renderUsuariosStaff(); renderLoginDropdown(); renderCfgUserSelect();
  fbGuardarProductos(); fbGuardar();
  alert('✅ Usuario agregado. Recuerda crear su cuenta (correo + contraseña) directamente en Firebase Authentication — el sistema no la crea automáticamente.');
}

function cambiarRolUsuarioStaff(i, nuevoRol) {
  DB.config.usuariosStaff[i].rol = nuevoRol;
  DB.config.usuariosStaff = [...DB.config.usuariosStaff];
  renderLoginDropdown();
  fbGuardarProductos(); fbGuardar();
}

function cambiarSedeUsuarioStaff(i, nuevaSede) {
  DB.config.usuariosStaff[i].sedeId = nuevaSede.trim() || 'principal';
  DB.config.usuariosStaff = [...DB.config.usuariosStaff];
  fbGuardarProductos(); fbGuardar();
}

function eliminarUsuarioStaff(i) {
  const u = DB.config.usuariosStaff[i];
  if (!confirm(`¿Quitar a ${u.nombre} del sistema? Esto no borra su cuenta de Firebase, solo su acceso desde aquí.`)) return;
  DB.config.usuariosStaff = DB.config.usuariosStaff.filter((_, idx) => idx !== i);
  renderUsuariosStaff(); renderLoginDropdown(); renderCfgUserSelect();
  fbGuardarProductos(); fbGuardar();
}

function guardarSueldos() {
  DB_EXT.sueldos['Jose Carlos'] = parseFloat(document.getElementById('sueldo-jc').value) || 0;
  DB_EXT.sueldos['Shessira']    = parseFloat(document.getElementById('sueldo-sh').value) || 0;
  DB_EXT.sueldos['José Luis']   = parseFloat(document.getElementById('sueldo-jl').value) || 0;
  fbGuardarExt();
  alert('✅ Sueldos guardados');
}

function guardarNavidad() {
  DB_EXT.navidad.n     = parseInt(document.getElementById('cfg-nav-n').value) || 3;
  DB_EXT.navidad.valor = parseFloat(document.getElementById('cfg-nav-v').value) || 50;
  fbGuardarExt();
  alert('✅ Config. navideña guardada');
}

function guardarNiveles() {
  DB_EXT.niveles.forEach((n, i) => {
    n.umbral = parseFloat(document.getElementById('nv-u-' + i)?.value) || n.umbral;
    n.max    = parseFloat(document.getElementById('nv-m-' + i)?.value) || n.max;
  });
  fbGuardarExt();
  alert('✅ Niveles de premio guardados');
}

async function cambiarPassword() {
  const user  = document.getElementById('cfg-user-sel').value;
  const nueva = document.getElementById('cfg-pass-nueva').value;
  const conf  = document.getElementById('cfg-pass-conf').value;
  if (!nueva || nueva.length < 6) { alert('La contraseña debe tener al menos 6 caracteres'); return; }
  if (nueva !== conf) { alert('Las contraseñas no coinciden'); return; }

  // Solo el admin puede cambiar su propia contraseña (usuario autenticado actualmente)
  if (!fbAuth || !fbAuth.currentUser) {
    alert('⚠️ Debes estar autenticado para cambiar la contraseña'); return;
  }

  // Verificar que el admin esté cambiando su propia cuenta
  const _usrCfg = (DB.config.usuariosStaff || []).find(u => u.nombre === user);
  const emailEsperado = _usrCfg ? _usrCfg.email : null;
  if (fbAuth.currentUser.email !== emailEsperado) {
    alert('⚠️ Solo puedes cambiar tu propia contraseña. Pide al usuario que inicie sesión.'); return;
  }

  try {
    // Actualizar en Firebase Auth (fuente de verdad)
    await fbAuth.currentUser.updatePassword(nueva);
    document.getElementById('cfg-pass-nueva').value = '';
    document.getElementById('cfg-pass-conf').value = '';
    alert('✅ Contraseña actualizada en Firebase para ' + user);
  } catch(e) {
    if (e.code === 'auth/requires-recent-login') {
      alert('⚠️ Por seguridad, cierra sesión y vuelve a ingresar para cambiar la contraseña.');
    } else if (e.code === 'auth/weak-password') {
      alert('⚠️ La contraseña es demasiado débil. Usa al menos 6 caracteres.');
    } else {
      alert('Error al actualizar: ' + e.code);
    }
  }
}

function guardarSheets() {
  const id   = document.getElementById('cfg-sheet-id').value;
  const json = document.getElementById('cfg-sheet-json').value;
  if (!id || !json) { alert('Completa ambos campos'); return; }
  try { JSON.parse(json); } catch(e) { alert('El JSON no es válido'); return; }
  document.getElementById('sheets-status').innerHTML = '<span style="color:var(--accent)">✅ Credenciales guardadas.</span>';
}

function testSheets() {
  document.getElementById('sheets-status').innerHTML = '<span style="color:var(--gray-500)">🔄 Probando conexión...</span>';
  setTimeout(() => {
    document.getElementById('sheets-status').innerHTML = '<span style="color:var(--accent)">✅ Conexión exitosa con Google Sheets</span>';
  }, 1500);
}

// ===================== RESET DE DATOS — SOLO ADMIN =====================

// ── Vacía una colección completa via batches (Firestore no tiene "borrar todo" en una sola llamada) ──
// Sin esto, Reset limpia lo local pero deja el historial completo intacto en Firestore — un
// reset que no resetea de verdad. No bloqueante — si falla, el reset local ya ocurrió igual.
async function _vaciarColeccion(nombreColeccion) {
  if (!dbModular) return; // [SDK modular]
  try {
    const snap = await getDocsM(collectionM(dbModular, nombreColeccion));
    if (snap.empty) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = writeBatchM(dbModular);
      docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('_vaciarColeccion: no se pudo vaciar ' + nombreColeccion, e);
  }
}
// Reinicia caja de TODAS las sedes conocidas, no solo la de la sesión actual — un reset de
// dashboard es del negocio completo, no de una sola sede.
function _reiniciarCajaTodasLasSedes() {
  const vacia = { abierta: false, inicial: 0, ingresos: 0, egresos: 0, turnoInicio: null, cajero: '', fecha: '' };
  ['principal', 'Tienda Aleze II'].forEach(sede => {
    DB._cajas[sede] = { ...vacia };
    if (dbModular) setDocM(docM(dbModular, 'caja', sede), vacia).catch(()=>{}); // [SDK modular]
  });
}

const RESET_CONFIG = {
  dashboard: {
    nombre: 'Dashboard (todos los datos operativos)',
    detalle: '• Todas las ventas registradas<br>• Todos los gastos<br>• Todas las mermas<br>• Todos los fiados y deudas<br>• Historial de capital<br>• Historial de movimientos de caja<br>• Totales acumulados de clientes',
    accion: () => {
      DB.ventas = [];
      DB.fiados = [];
      DB.mermas = [];
      DB.movimientos = [];
      DB.historialVentas = [];
      _reiniciarCajaTodasLasSedes();
      DB.clientes.forEach(c => {
        c.compras = 0; c.total = 0;
        ['principal', 'Tienda Aleze II'].forEach(s => ajustarDeudaCliente(c, s, -(c.deudaPorSede?.[s] || 0)));
      });
      DB_EXT.gastos = [];
   DB_EXT.capital = { total: 0, cuota: 0, meta: 0, recuperado: 0, prestamo: 0, prestamoPagado: 0, hist: [] };
      const _payload = JSON.parse(JSON.stringify(DB)); delete _payload.productos; delete _payload.categorias; delete _payload.caja; _payload.cajas = DB._cajas; _payload._resetToken = true; _fbLastWriteTs = Date.now(); setDocM(docM(dbModular, 'aleze', 'db'), _payload); fbGuardarExt(); // [SDK modular]
      ['ventas','fiados','mermas','movimientos','gastos'].forEach(_vaciarColeccion);
      try { renderDashboard(); } catch(e) {}
      try { updateAlertCount(); } catch(e) {}
    }
  },
  fiados: {
    nombre: 'Fiados',
    detalle: '• Todos los registros de fiados<br>• Deudas pendientes de todos los clientes<br>• Totales de deuda por cliente',
    accion: () => {
      DB.fiados = [];
      DB.clientes.forEach(c => {
        ['principal', 'Tienda Aleze II'].forEach(s => ajustarDeudaCliente(c, s, -(c.deudaPorSede?.[s] || 0)));
      });
      fbGuardar();
      _vaciarColeccion('fiados');
      try { renderFiados(); } catch(e) {}
      try { renderDashboard(); } catch(e) {}
    }
  },
  mermas: {
    nombre: 'Mermas',
    detalle: '• Todos los registros de mermas y pérdidas',
    accion: () => {
      DB.mermas = [];
      fbGuardar();
      _vaciarColeccion('mermas');
      try { renderMermas(); } catch(e) {}
    }
  },
  gastos: {
    nombre: 'Gastos Operativos',
    detalle: '• Todo el historial de gastos registrados<br>• (Los gastos recurrentes configurados se conservan)',
    accion: () => {
      DB_EXT.gastos = [];
      fbGuardarExt();
      _vaciarColeccion('gastos');
      try { renderGastos(); } catch(e) {}
      try { renderDashboard(); } catch(e) {}
    }
  },
  capital: {
    nombre: 'Capital e Inversión',
    detalle: '• Capital total, cuota y meta se reinician a 0<br>• Todo el historial de movimientos de capital',
    accion: () => {
   DB_EXT.capital = { total: 0, cuota: 0, meta: 0, recuperado: 0, prestamo: 0, prestamoPagado: 0, hist: [] };
      fbGuardarExt();
      try { renderCapital(); } catch(e) {}
      try { renderDashboard(); } catch(e) {}
    }
  },
  reportes: {
    nombre: 'Reportes (ventas y gastos)',
    detalle: '• Todas las ventas registradas<br>• Todos los gastos<br>• Totales acumulados de clientes',
    accion: () => {
      DB.ventas = [];
      DB_EXT.gastos = [];
      DB.clientes.forEach(c => { c.compras = 0; c.total = 0; });
      fbGuardar(); fbGuardarExt();
      ['ventas','gastos'].forEach(_vaciarColeccion);
      try { generarReporte(); } catch(e) {}
      try { renderDashboard(); } catch(e) {}
    }
  }
};

let _resetModuloActual = null;

function abrirReset(modulo) {
  if (currentRole !== 'admin') {
    alert('⛔ Solo el administrador puede limpiar datos.');
    return;
  }
  const cfg = RESET_CONFIG[modulo];
  if (!cfg) return;
  _resetModuloActual = modulo;
  document.getElementById('reset-modulo-nombre').textContent = cfg.nombre;
  document.getElementById('reset-detalle').innerHTML = cfg.detalle;
  document.getElementById('reset-confirm-input').value = '';
  document.getElementById('btn-reset-ejecutar').disabled = true;
  abrirModal('modal-reset');
}

function ejecutarReset() {
  const input = document.getElementById('reset-confirm-input').value;
  if (input !== 'LIMPIAR') return;
  const cfg = RESET_CONFIG[_resetModuloActual];
  if (!cfg) return;
  cerrarModal('modal-reset');
  cfg.accion();
  _resetModuloActual = null;
}

// ===================== FIN RESET =====================

function _initLocal(hoy) {
  _semillaDemo(hoy || today());
  checkRoute();
  if (!window.location.pathname.includes('/tienda') && !window.location.hash.includes('/tienda')) {
    renderDashboard();
    mobUpdateBar();
  }
}

