// ===================== CONFIGURACION =====================
function _uploadConfigImg(fileInput, targetFieldId, storagePath) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!storageModular) { alert('Storage no disponible'); return; }
  const btn = fileInput.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      // Limite de resolucion para CUALQUIER imagen subida desde Configuracion (banners
      // mobile/PC/servicios, e imagen de tienda externa) — los 4 casos se muestran a ancho
      // amplio en la practica (width:100% de su contenedor), ninguno es un icono chico. El
      // limite anterior (800px) reducia a la mitad la resolucion recomendada para el banner
      // PC (1750px), causando falta de nitidez visible al mostrarse estirado en pantallas
      // anchas o de alta densidad de pixeles.
      const MAX = 1800;
      const ratio = Math.min(MAX/img.width, MAX/img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        try {
          const ref = refM(storageModular, storagePath);
          await uploadBytesM(ref, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=2592000' });
          const url = await getDownloadURLM(ref);
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
  // Migración automática, una sola vez: el banner unico viejo (bannerUrl/bannerLink) pasa a
  // ser el primer elemento del array — sin esto, el banner ya cargado desaparecería al pasar
  // al carrusel. bannerUrl/bannerLink se dejan de usar de acá en adelante, pero no se borran
  // del documento por si algo viejo los sigue leyendo.
  if ((!cfg.banners || !cfg.banners.length) && cfg.bannerUrl) {
    cfg.banners = [{ id: getId(), url: cfg.bannerUrl, link: cfg.bannerLink || '' }];
  }
  if (!cfg.banners) cfg.banners = [];
  const el = document.getElementById('cfg-eslogan'); if (el) el.value = cfg.eslogan || '';
  const dm = document.getElementById('cfg-delivery-minimo'); if (dm) dm.value = cfg.deliveryMinimo || 20;
  const bv = document.getElementById('cfg-banner-visible'); if (bv) bv.checked = cfg.bannerVisible !== false;
  // Banners — carrusel: lista de tarjetas, cada una con su propia imagen y link opcional.
  const bl2 = document.getElementById('cfg-banners-lista');
if (bl2) bl2.innerHTML = cfg.banners.map((b, i) => `
    <div style="border:1px solid var(--gray-200);border-radius:8px;padding:.75rem;margin-bottom:.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
        <div style="font-weight:700;font-size:.82rem">Banner ${i+1}</div>
        <button type="button" class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarBanner(${i})">🗑️ Quitar</button>
      </div>
      <div class="form-group"><label style="font-size:.75rem">Imagen móvil/app (800×300px recomendado)</label><div style="display:flex;gap:.4rem;align-items:center">${b.url ? `<img src="${b.url}" style="width:60px;height:24px;object-fit:cover;border-radius:4px;flex-shrink:0">` : ''}<input type="text" class="form-control" id="cfg-ban-img-${i}" value="${b.url||''}" placeholder="https://firebasestorage..." style="flex:1"/><input type="file" id="_ban-file-${i}" accept="image/*" style="display:none" onchange="_uploadConfigImg(this,'cfg-ban-img-${i}','tienda/banner-${b.id}.webp')"><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('_ban-file-'+${i}).click()">📁</button></div></div>
      <div class="form-group"><label style="font-size:.75rem">Imagen PC/web (opcional — más panorámica, ej. 1750×500px. Si se deja vacío, usa la imagen móvil de arriba)</label><div style="display:flex;gap:.4rem;align-items:center">${b.urlDesktop ? `<img src="${b.urlDesktop}" style="width:60px;height:17px;object-fit:cover;border-radius:4px;flex-shrink:0">` : ''}<input type="text" class="form-control" id="cfg-ban-imgpc-${i}" value="${b.urlDesktop||''}" placeholder="https://firebasestorage..." style="flex:1"/><input type="file" id="_ban-file-pc-${i}" accept="image/*" style="display:none" onchange="_uploadConfigImg(this,'cfg-ban-imgpc-${i}','tienda/banner-pc-${b.id}.webp')"><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('_ban-file-pc-'+${i}).click()">📁</button></div></div>
      <div class="form-group" style="margin-bottom:0"><label style="font-size:.75rem">Link destino al hacer clic (opcional)</label><input type="text" class="form-control" id="cfg-ban-link-${i}" value="${b.link||''}" placeholder="https://..." /></div>
    </div>`).join('') || '<div style="font-size:.78rem;color:var(--gray-400);padding:.5rem 0">Sin banners todavía — agrega el primero.</div>';
const wa = document.getElementById('cfg-wa-servicios'); if (wa) wa.value = cfg.whatsappTienda || '';
  const tt = document.getElementById('cfg-tiendas-texto'); if (tt) tt.value = cfg.tiendasTexto || '';
  // Migración automática, una sola vez: el banner único viejo de servicios pasa a ser el
  // primer elemento del array — mismo criterio ya usado para el banner principal.
  if ((!cfg.serviciosBanners || !cfg.serviciosBanners.length) && cfg.serviciosBannerUrl) {
    cfg.serviciosBanners = [{ id: getId(), url: cfg.serviciosBannerUrl }];
  }
  if (!cfg.serviciosBanners) cfg.serviciosBanners = [];
  const bl3 = document.getElementById('cfg-servicios-banners-lista');
  if (bl3) bl3.innerHTML = cfg.serviciosBanners.map((b, i) => `
    <div style="border:1px solid var(--gray-200);border-radius:8px;padding:.75rem;margin-bottom:.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
        <div style="font-weight:700;font-size:.82rem">Banner ${i+1}</div>
        <button type="button" class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarServicioBanner(${i})">🗑️ Quitar</button>
      </div>
      <div class="form-group" style="margin-bottom:0"><label style="font-size:.75rem">Imagen (800×300px recomendado)</label><div style="display:flex;gap:.4rem;align-items:center">${b.url ? `<img src="${b.url}" style="width:60px;height:24px;object-fit:cover;border-radius:4px;flex-shrink:0">` : ''}<input type="text" class="form-control" id="cfg-svcban-img-${i}" value="${b.url||''}" placeholder="https://firebasestorage..." style="flex:1"/><input type="file" id="_svcban-file-${i}" accept="image/*" style="display:none" onchange="_uploadConfigImg(this,'cfg-svcban-img-${i}','tienda/banner-servicios-${b.id}.webp')"><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('_svcban-file-'+${i}).click()">📁</button></div></div>
    </div>`).join('') || '<div style="font-size:.78rem;color:var(--gray-400);padding:.5rem 0">Sin banners de servicios todavía.</div>';
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
// Guarda antes de re-renderizar la lista — asi no se pierde texto ya tipeado en otros
// banners si el admin agrega/quita uno a medio llenar el formulario.
function agregarBanner() {
  if (currentRole !== 'admin') return;
  guardarConfigTienda(true);
  if (!DB.config.banners) DB.config.banners = [];
  DB.config.banners.push({ id: getId(), url: '', link: '' });
  renderConfiguracion();
}
function eliminarBanner(i) {
  if (currentRole !== 'admin') return;
  guardarConfigTienda(true);
  DB.config.banners.splice(i, 1);
  fbGuardar(); fbGuardarProductos();
  renderConfiguracion();
}
// Mismo patrón que agregarBanner/eliminarBanner, para el carrusel de servicios rápidos.
function agregarServicioBanner() {
  if (currentRole !== 'admin') return;
  guardarConfigTienda(true);
  if (!DB.config.serviciosBanners) DB.config.serviciosBanners = [];
  DB.config.serviciosBanners.push({ id: getId(), url: '' });
  renderConfiguracion();
}
function eliminarServicioBanner(i) {
  if (currentRole !== 'admin') return;
  guardarConfigTienda(true);
  DB.config.serviciosBanners.splice(i, 1);
  fbGuardar(); fbGuardarProductos();
  renderConfiguracion();
}

function guardarConfigTienda(_silencioso) {
  if (currentRole !== 'admin') return;
  const cfg = DB.config;
  cfg.eslogan    = document.getElementById('cfg-eslogan')?.value.trim() || 'Todo lo que necesitas, cerca de ti';
  cfg.deliveryMinimo = parseFloat(document.getElementById('cfg-delivery-minimo')?.value) || 20;
  cfg.bannerVisible = document.getElementById('cfg-banner-visible')?.checked !== false;
(cfg.banners || []).forEach((b, i) => {
    b.url        = document.getElementById(`cfg-ban-img-${i}`)?.value.trim() || '';
    b.urlDesktop = document.getElementById(`cfg-ban-imgpc-${i}`)?.value.trim() || '';
    b.link       = document.getElementById(`cfg-ban-link-${i}`)?.value.trim() || '';
  });
cfg.tiendasTexto = document.getElementById('cfg-tiendas-texto')?.value.trim() || '';
  (cfg.serviciosBanners || []).forEach((b, i) => {
    b.url = document.getElementById(`cfg-svcban-img-${i}`)?.value.trim() || '';
  });
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
  if (!_silencioso) alert('✅ Configuración de tienda guardada');
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
  const _pp = DB.config.pasarelaPago || { activa: false, llavePublica: '' };
  document.getElementById('cfg-pasarela-activa').checked = !!_pp.activa;
  document.getElementById('cfg-pasarela-llave').value = _pp.llavePublica || '';
  document.getElementById('cfg-pasarela-detalle').style.display = _pp.activa ? 'block' : 'none';
  document.getElementById('cfg-regimen-tributario').value = DB.config.regimenTributario || '';
  const _ce = DB.config.comprobanteElectronico || { activa: false, serieBoleta: '', serieFactura: '' };
  document.getElementById('cfg-comprobante-activa').checked = !!_ce.activa;
  document.getElementById('cfg-serie-boleta').value = _ce.serieBoleta || '';
  document.getElementById('cfg-serie-factura').value = _ce.serieFactura || '';
  document.getElementById('cfg-comprobante-detalle').style.display = _ce.activa ? 'block' : 'none';
  _cargarComprobantesConError();
  renderConfigTienda();
  renderUsuariosStaff();
  renderCfgUserSelect();
}

function guardarConfigPasarela() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede modificar la pasarela de pago.'); return; }
  DB.config.pasarelaPago = {
    activa: document.getElementById('cfg-pasarela-activa').checked,
    proveedor: 'izipay',
    llavePublica: document.getElementById('cfg-pasarela-llave').value.trim()
  };
  fbGuardarProductos();
  alert('✅ Configuración guardada.' + (DB.config.pasarelaPago.activa ? '\n\nRecuerda: esto solo funciona si ya desplegaste las Cloud Functions del repositorio — activar el interruptor no las despliega solas.' : ''));
}

// Regimen tributario y comprobante electronico solo los necesita el staff (POS, confirmar
// entrega de pedido online) — a diferencia de pasarelaPago, aca no hay ningun boton visible
// para el cliente final en tienda publica que dependa de esto, asi que basta con fbGuardar()
// (documento privado), no hace falta duplicarlo en el documento publico via fbGuardarProductos().
function guardarConfigComprobante() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede modificar el comprobante electrónico.'); return; }
  DB.config.regimenTributario = document.getElementById('cfg-regimen-tributario').value || null;
  DB.config.comprobanteElectronico = {
    activa: document.getElementById('cfg-comprobante-activa').checked,
    serieBoleta: document.getElementById('cfg-serie-boleta').value.trim().toUpperCase() || null,
    serieFactura: document.getElementById('cfg-serie-factura').value.trim().toUpperCase() || null
  };
  fbGuardar();
  alert('✅ Configuración guardada.' + (DB.config.comprobanteElectronico.activa ? '\n\nRecuerda: esto solo funciona si ya desplegaste las Cloud Functions del repositorio y configuraste el Token del proveedor como Secret — activar el interruptor no hace eso solo.' : ''));
}

// Comprobantes que el proveedor no pudo emitir (caído, dato mal configurado, etc.) — la
// venta en si ya esta guardada de todas formas, esto es solo un panel de seguimiento para
// que el admin decida cuando reintentar. Vive en 2 colecciones (ventas y fiados), asi que se
// consultan ambas y se muestran juntas.
async function _cargarComprobantesConError() {
  const cont = document.getElementById('comprobantes-error-lista');
  if (!cont) return;
  if (!dbModular) { cont.textContent = 'Sin conexión con el sistema en este momento.'; return; }
  try {
    const [ventasSnap, fiadosSnap] = await Promise.all([
      getDocsM(queryM(collectionM(dbModular, 'ventas'), whereM('comprobante.estado', '==', 'error'))),
      getDocsM(queryM(collectionM(dbModular, 'fiados'), whereM('comprobante.estado', '==', 'error')))
    ]);
    const items = [
      ...ventasSnap.docs.map(d => ({ id: d.id, coleccion: 'ventas', ...d.data() })),
      ...fiadosSnap.docs.map(d => ({ id: d.id, coleccion: 'fiados', ...d.data() }))
    ];
    if (items.length === 0) {
      cont.innerHTML = '<div style="color:var(--gray-400)">✅ Sin comprobantes pendientes de revisar.</div>';
      return;
    }
    cont.innerHTML = items.map(v => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--gray-100)">
        <div>
          <div><strong>${escapeHtml(v.clienteNombre) || 'Cliente'}</strong> — ${sol(v.total||0)} — ${v.fecha||''}</div>
          <div style="color:var(--danger);font-size:.72rem">${(v.comprobante && v.comprobante.errorMsg) || 'Error desconocido'}</div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="reintentarComprobante('${v.coleccion}','${v.id}', this)">🔄 Reintentar</button>
      </div>
    `).join('');
  } catch (e) {
    cont.innerHTML = '<div style="color:var(--danger)">No se pudo cargar la lista: ' + (e.message||'error desconocido') + '</div>';
  }
}

// Pide al servidor que vuelva a intentar emitir un comprobante puntual — solo staff
// autenticado puede llamar esto (verificado del lado del servidor también, ver
// reintentarComprobante() en functions/index.js). La venta ya existe de antes; esto nunca la
// toca, solo reintenta la parte de SUNAT.
async function reintentarComprobante(coleccion, id, btnEl) {
  if (!functionsModular) { alert('Las Cloud Functions no están desplegadas todavía — no hay nada que reintentar.'); return; }
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳...'; }
  try {
    const fn = httpsCallableM(functionsModular, 'reintentarComprobante');
    await fn({ coleccion, id });
    alert('✅ Reintento enviado. Actualizando la lista...');
    _cargarComprobantesConError();
  } catch (e) {
    alert('⚠️ No se pudo reintentar: ' + (e.message || 'error desconocido'));
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔄 Reintentar'; }
  }
}

function guardarConfig() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede modificar la configuración.'); return; }
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
      <button type="button" class="btn btn-xs" style="background:var(--danger-light);color:var(--danger)" onclick="eliminarUsuarioStaff(${i})">🗑️</button>
    </div>`).join('');
}

function agregarUsuarioStaff() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede agregar usuarios.'); return; }
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
  // CRITICO: sin este chequeo, un vendedor podia llamar esta funcion directo desde la
  // consola sobre si mismo, cambiando su propio rol a admin en usuariosStaff — la misma
  // fuente que sincronizarRolesStaff() lee para asignar el custom claim real en cada login.
  // Sin este chequeo, esto era una escalada de privilegios completa y permanente.
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede cambiar roles.'); return; }
  DB.config.usuariosStaff[i].rol = nuevoRol;
  DB.config.usuariosStaff = [...DB.config.usuariosStaff];
  renderLoginDropdown();
  fbGuardarProductos(); fbGuardar();
}

function eliminarUsuarioStaff(i) {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede quitar usuarios.'); return; }
  const u = DB.config.usuariosStaff[i];
  if (!confirm(`¿Quitar a ${u.nombre} del sistema? Esto no borra su cuenta de Firebase, solo su acceso desde aquí.`)) return;
  DB.config.usuariosStaff = DB.config.usuariosStaff.filter((_, idx) => idx !== i);
  renderUsuariosStaff(); renderLoginDropdown(); renderCfgUserSelect();
  fbGuardarProductos(); fbGuardar();
}

function guardarSueldos() {
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede modificar sueldos.'); return; }
  DB_EXT.sueldos['Jose Carlos'] = parseFloat(document.getElementById('sueldo-jc').value) || 0;
  DB_EXT.sueldos['Shessira']    = parseFloat(document.getElementById('sueldo-sh').value) || 0;
  DB_EXT.sueldos['José Luis']   = parseFloat(document.getElementById('sueldo-jl').value) || 0;
  fbGuardarExt();
  alert('✅ Sueldos guardados');
}

async function cambiarPassword() {
  const user  = document.getElementById('cfg-user-sel').value;
  const nueva = document.getElementById('cfg-pass-nueva').value;
  const conf  = document.getElementById('cfg-pass-conf').value;
  if (!nueva || nueva.length < 6) { alert('La contraseña debe tener al menos 6 caracteres'); return; }
  if (nueva !== conf) { alert('Las contraseñas no coinciden'); return; }

  // Solo el admin puede cambiar su propia contraseña (usuario autenticado actualmente)
  if (!authModular || !authModular.currentUser) {
    alert('⚠️ Debes estar autenticado para cambiar la contraseña'); return;
  }

  // Verificar que el admin esté cambiando su propia cuenta
  const _usrCfg = (DB.config.usuariosStaff || []).find(u => u.nombre === user);
  const emailEsperado = _usrCfg ? _usrCfg.email : null;
  if (authModular.currentUser.email !== emailEsperado) {
    alert('⚠️ Solo puedes cambiar tu propia contraseña. Pide al usuario que inicie sesión.'); return;
  }

  try {
    // Actualizar en Firebase Auth (fuente de verdad)
    await window.__fbModular.auth.updatePassword(authModular.currentUser, nueva);
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
// ── Migración manual, una sola vez: corrige registros que todavía tengan sedeId="Tienda
// Reinicia la caja del negocio a su estado inicial (sin abrir, sin movimientos).
function _reiniciarCaja() {
  const vacia = { abierta: false, inicial: 0, ingresos: 0, egresos: 0, turnoInicio: null, cajero: '', fecha: '' };
  DB._cajas.principal = { ...vacia };
  if (dbModular) setDocM(docM(dbModular, 'caja', 'principal'), vacia).catch(()=>{}); // [SDK modular]
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
      _reiniciarCaja();
      DB.clientes.forEach(c => {
        c.compras = 0; c.total = 0;
        ajustarDeudaCliente(c, -(c.deuda||0));
      });
      DB_EXT.gastos = [];
      DB_EXT.capital = { prestamo: 0, cuota: 0, meta: 0 };
      const _payload = JSON.parse(JSON.stringify(DB)); delete _payload.productos; delete _payload.categorias; delete _payload.caja; _payload.cajas = DB._cajas; _payload._resetToken = true; _fbLastWriteTs = Date.now(); setDocM(docM(dbModular, 'aleze', 'db'), _payload); fbGuardarExt(); // [SDK modular]
      ['ventas','fiados','mermas','movimientos','gastos','capital_movimientos'].forEach(_vaciarColeccion);
      DB.capitalMovimientos = [];
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
        ajustarDeudaCliente(c, -(c.deuda||0));
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
  if (currentRole !== 'admin') { alert('⛔ Solo el administrador puede limpiar datos.'); return; }
  const input = document.getElementById('reset-confirm-input').value;
  if (input !== 'LIMPIAR') return;
  const cfg = RESET_CONFIG[_resetModuloActual];
  if (!cfg) return;
  cerrarModal('modal-reset');
  cfg.accion();
  _resetModuloActual = null;
}

// ===================== FIN RESET =====================

