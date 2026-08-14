/**
 * ══════════════════════════════════════════════════════════════════════════
 * Tienda Aleze — Cloud Functions: pasarela de pago (Izipay)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ESTADO: escrito y listo, pero DORMIDO — no se despliega automáticamente.
 * Nada de esto corre hasta que alguien ejecute `firebase deploy --only functions`
 * manualmente, con las credenciales del proyecto.
 *
 * POR QUÉ EXISTE ESTO (y no alcanza con hacerlo desde index.html):
 * El resto de la app corre sin servidor propio — GitHub Pages + Firestore
 * directo desde el navegador. Eso funciona para casi todo, pero NO para
 * confirmar un pago real: si solo confiamos en que el navegador del cliente
 * diga "pagué", cualquiera podría fingir ese resultado sin haber pagado.
 * Izipay necesita mandarle la confirmación a un SERVIDOR (no al navegador
 * del cliente) — eso es exactamente lo que hace webhookIzipay más abajo.
 *
 * ANTES DE DESPLEGAR ESTO ALGUNA VEZ, HACE FALTA:
 * 1. Confirmar con Izipay el nombre exacto de sus endpoints y campos —
 *    este código sigue el patrón estándar de pasarelas basadas en Lyra
 *    (formToken + verificación HMAC del webhook), que es la tecnología
 *    sobre la que están construidas varias pasarelas latinoamericanas,
 *    pero los nombres EXACTOS de campos y URLs hay que verificarlos
 *    contra la documentación actual de Izipay, no contra este código.
 * 2. Cargar las llaves como Secrets de Firebase (nunca en el código ni
 *    en Firestore) — ver sección de configuración más abajo.
 * 3. Configurar la URL del webhook en el panel de Izipay una vez desplegado.
 *
 * ══════════════════════════════════════════════════════════════════════════
 */

const { onRequest, onCall } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// ── Secrets de Izipay — se cargan con `firebase functions:secrets:set` ──
// NUNCA hardcodear estas llaves acá ni guardarlas en Firestore. La llave
// pública (para el checkout del cliente) sí puede vivir en Firestore
// (DB.config.pasarelaPago.llavePublica) porque está diseñada para ser
// visible en el navegador — la privada y la de verificación de firma no.
const IZIPAY_LLAVE_PRIVADA = defineSecret("IZIPAY_LLAVE_PRIVADA");
const IZIPAY_LLAVE_HMAC = defineSecret("IZIPAY_LLAVE_HMAC");

// ── Secret del proveedor de facturación electrónica (ej. Nubefact) — mismo criterio que
// Izipay arriba: se carga con `firebase functions:secrets:set NUBEFACT_TOKEN`, nunca en
// código ni en Firestore.
const NUBEFACT_TOKEN = defineSecret("NUBEFACT_TOKEN");

// TODO: confirmar con Izipay la URL exacta de su API de creación de sesión
// (formToken). Este valor es un placeholder siguiendo el patrón Lyra estándar.
const IZIPAY_API_URL = "https://api.micuentaweb.pe/api-payment/V4/Charge/CreatePayment";

/**
 * ── crearSesionPago ──────────────────────────────────────────────────────
 * Llamada desde la tienda pública cuando el cliente elige "Pagar en línea".
 * Crea la sesión de pago del lado del servidor (con la llave privada, que
 * nunca debe tocar el navegador) y devuelve un token que el checkout de
 * Izipay usa para mostrar el formulario de pago.
 *
 * No confirma el pago — solo lo INICIA. La confirmación real llega después,
 * por separado, al webhook de abajo.
 */
exports.crearSesionPago = onCall(
  { secrets: [IZIPAY_LLAVE_PRIVADA], region: "us-central1" },
  async (request) => {
    // Verificación server-side del interruptor — no confiar solo en que la UI oculte el
    // botón. Mismo patrón ya probado en _procesarComprobante() (comprobante electrónico, más
    // abajo): sin esto, alguien que conozca el nombre de esta función (el repositorio es
    // público) podría llamarla directo, sin pasar por la UI, sin importar si el admin activó
    // o no la pasarela desde Configuración. Se verifica ANTES que cualquier otra cosa, para
    // rechazar de inmediato sin necesitar leer nada más de Firestore si está apagado.
    const cfgSnap = await db.collection("aleze").doc("config").get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.pasarelaPago || !cfg.pasarelaPago.activa) {
      throw new Error("El pago en línea no está activo en este momento.");
    }

    const { pedidoId, monto, moneda } = request.data || {};

    if (!pedidoId || !monto || monto <= 0) {
      throw new Error("Datos de pedido inválidos para iniciar el pago.");
    }

    // Verifica que el pedido exista y que el monto coincida con lo real
    // guardado en Firestore — nunca confiar en el monto que manda el cliente
    // sin cruzarlo contra el pedido real, o alguien podría pagar de menos.
    const pedidoRef = db.collection("pedidos_online").doc(String(pedidoId));
    const pedidoSnap = await pedidoRef.get();
    if (!pedidoSnap.exists) {
      throw new Error("Pedido no encontrado.");
    }
    const pedido = pedidoSnap.data();
    if (Math.abs((pedido.total || 0) - monto) > 0.01) {
      throw new Error("El monto no coincide con el total real del pedido.");
    }
    if (pedido.pagoEstado === "confirmado") {
      throw new Error("Este pedido ya fue pagado.");
    }

    // TODO: verificar la forma exacta del payload que espera Izipay — esto
    // sigue el patrón estándar (monto en céntimos, moneda ISO, referencia
    // de orden propia) pero los nombres de campo exactos hay que
    // confirmarlos con su documentación actual antes de desplegar.
    const payload = {
      amount: Math.round(monto * 100), // en céntimos
      currency: moneda || "PEN",
      orderId: String(pedidoId),
      formAction: "PAYMENT",
    };

    try {
      const resp = await fetch(IZIPAY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(IZIPAY_LLAVE_PRIVADA.value() + ":").toString("base64"),
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();

      if (!resp.ok) {
        logger.error("Izipay rechazó la creación de sesión", data);
        throw new Error("No se pudo iniciar el pago. Intenta de nuevo.");
      }

      // Marca el pedido como "esperando pago" — todavía no confirmado.
      await pedidoRef.update({ pagoEstado: "pendiente", pagoIniciado: admin.firestore.FieldValue.serverTimestamp() });

      // TODO: el nombre exacto del campo con el token depende de la
      // respuesta real de Izipay — placeholder siguiendo el patrón Lyra.
      return { formToken: data.answer?.formToken || null };
    } catch (err) {
      logger.error("Error creando sesión de pago Izipay:", err);
      throw new Error("No se pudo conectar con la pasarela de pago.");
    }
  }
);

/**
 * ── webhookIzipay ────────────────────────────────────────────────────────
 * Endpoint HTTP que Izipay llama directo desde SUS servidores (nunca desde
 * el navegador del cliente) cuando un pago se confirma. Esta es la pieza
 * de seguridad real — sin esto, cualquiera podría fingir "ya pagué" sin
 * haber pagado de verdad.
 *
 * URL para configurar en el panel de Izipay, una vez desplegado:
 * https://us-central1-<PROJECT_ID>.cloudfunctions.net/webhookIzipay
 */
exports.webhookIzipay = onRequest(
  { secrets: [IZIPAY_LLAVE_HMAC], region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // ── Verificación de firma — CRÍTICO, nunca procesar sin esto ──
    // TODO: confirmar con Izipay el algoritmo exacto y qué campo trae la
    // firma (header vs. cuerpo). Esto sigue el patrón HMAC-SHA256 estándar
    // de las pasarelas basadas en Lyra, pero hay que verificarlo contra su
    // documentación real antes de desplegar — una verificación incorrecta
    // es tan riesgosa como no tener ninguna.
    const firmaRecibida = req.headers["kr-hash"] || req.body?.["kr-hash"];
    const cuerpoParaFirmar = req.body?.["kr-answer"] || JSON.stringify(req.body);
    const firmaEsperada = crypto
      .createHmac("sha256", IZIPAY_LLAVE_HMAC.value())
      .update(cuerpoParaFirmar)
      .digest("hex");

    if (!firmaRecibida || firmaRecibida !== firmaEsperada) {
      logger.warn("webhookIzipay: firma inválida — posible intento fraudulento", {
        ip: req.ip,
      });
      res.status(401).send("Firma inválida");
      return;
    }

    // TODO: confirmar la estructura exacta de la respuesta de Izipay para
    // extraer el estado del pago y el orderId — placeholder razonable.
    let datos;
    try {
      datos = typeof cuerpoParaFirmar === "string" ? JSON.parse(cuerpoParaFirmar) : cuerpoParaFirmar;
    } catch (e) {
      res.status(400).send("Cuerpo inválido");
      return;
    }

    const pedidoId = datos.orderDetails?.orderId || datos.orderId;
    const estadoPago = datos.orderStatus; // ej: "PAID", "UNPAID", "RUNNING"

    if (!pedidoId) {
      res.status(400).send("Sin referencia de pedido");
      return;
    }

    const pedidoRef = db.collection("pedidos_online").doc(String(pedidoId));

    try {
      if (estadoPago === "PAID") {
        await pedidoRef.update({
          pagoEstado: "confirmado",
          pagoConfirmadoTs: admin.firestore.FieldValue.serverTimestamp(),
          pagoReferencia: datos.transactions?.[0]?.uuid || null,
        });
        logger.info(`Pago confirmado para pedido ${pedidoId}`);
      } else {
        await pedidoRef.update({
          pagoEstado: "fallido",
          pagoFallidoTs: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Pago no exitoso para pedido ${pedidoId}: ${estadoPago}`);
      }
      // Izipay espera una respuesta 200 rápida para no reintentar de más.
      res.status(200).send("OK");
    } catch (err) {
      logger.error("Error actualizando pedido tras webhook:", err);
      res.status(500).send("Error interno");
    }
  }
);

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Notificación push real (Firebase Cloud Messaging) — pedido online nuevo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ HACE FALTA UNA CLOUD FUNCTION PARA ESTO:
 * El sistema ya avisaba de pedidos nuevos con new Notification() directo
 * desde el navegador (ver notificarNuevoPedido() en index.html) — pero eso
 * SOLO funciona mientras la pestaña está abierta y activa. Para avisar con
 * el celular bloqueado o la app cerrada, el aviso tiene que salir de un
 * SERVIDOR (FCM), no del navegador del cajero — por eso vive acá.
 *
 * Se dispara solo, automáticamente, cada vez que se crea un documento nuevo
 * en pedidos_online — no hace falta llamarla desde ningún lado.
 *
 * REQUIERE (ver FCM-NOTIFICACIONES-PUSH.md para la guía completa paso a paso):
 * 1. Plan Blaze activo (ya lo está).
 * 2. Desplegar esto con `firebase deploy --only functions`.
 * 3. La colección staff_tokens debe existir con las reglas correspondientes
 *    (ver bloque de reglas en la guía) — ahí se guarda qué dispositivo de
 *    qué usuario debe recibir el aviso.
 */
exports.notificarPedidoNuevo = onDocumentCreated("pedidos_online/{pedidoId}", async (event) => {
  const pedido = event.data?.data();
  if (!pedido) return;
  // Solo avisar de pedidos recién llegados, pendientes de atender.
  if (pedido.estado !== "pendiente") return;

  const tokensSnap = await db.collection("staff_tokens").get();
  if (tokensSnap.empty) {
    logger.info("Pedido nuevo, pero no hay dispositivos registrados para avisar.");
    return;
  }

  // Capa de seguridad de privacidad: un dispositivo que cerro sesion normalmente ya se borro
  // de staff_tokens al hacer logout (ver doLogout() en auth.js) — pero si alguien desinstala
  // la app o borra datos SIN cerrar sesion primero, ese borrado nunca llega a ejecutarse y el
  // registro queda huerfano para siempre. Como red de seguridad adicional, cualquier token sin
  // actividad reciente (no volvio a iniciar sesion como staff en mas de 45 dias, o nunca
  // registro fecha) se trata como abandonado: no recibe el aviso, y se limpia de una vez.
  const UMBRAL_INACTIVIDAD_MS = 45 * 24 * 60 * 60 * 1000;
  const ahora = Date.now();
  const tokens = [];
  const tokensAbandonados = [];
  tokensSnap.docs.forEach((d) => {
    const ultimaActividad = d.data().ultimaActividad;
    const ts = ultimaActividad && typeof ultimaActividad.toMillis === "function" ? ultimaActividad.toMillis() : 0;
    if (!ts || (ahora - ts) > UMBRAL_INACTIVIDAD_MS) {
      tokensAbandonados.push(d.id);
    } else {
      tokens.push(d.id); // el ID del documento ES el token
    }
  });
  if (tokensAbandonados.length > 0) {
    const batchAbandonados = db.batch();
    tokensAbandonados.forEach((t) => batchAbandonados.delete(db.collection("staff_tokens").doc(t)));
    await batchAbandonados.commit();
    logger.info(`Limpiados ${tokensAbandonados.length} dispositivo(s) sin actividad reciente (>45 dias).`);
  }
  if (tokens.length === 0) {
    logger.info("Pedido nuevo, pero no hay dispositivos activos para avisar.");
    return;
  }

  // Mensaje solo de datos (sin campo "notification") — así el manejador propio del
  // Service Worker (onBackgroundMessage) decide exactamente cómo se ve, sin que
  // el navegador muestre una notificación genérica por su cuenta y quede duplicada.
  // CRITICO: android.priority:'high' — sin esto, Android puede retrasar o directamente
  // descartar el mensaje cuando el celular esta en ahorro de bateria con la app cerrada,
  // que es exactamente el escenario real de un vendedor con el telefono guardado.
  const mensaje = {
    data: {
      titulo: "🛍️ Nuevo pedido online",
      cuerpo: `${pedido.clienteNombre || "Cliente"} — S/ ${(pedido.total || 0).toFixed(2)}`,
      pedidoId: String(event.params.pedidoId),
    },
    android: {
      priority: "high",
    },
    tokens,
  };

  try {
    const resp = await admin.messaging().sendEachForMulticast(mensaje);
    // Limpiar tokens que ya no sirven (dispositivo desinstaló la app, permiso revocado, etc.)
    // — sin esto, staff_tokens acumula basura para siempre y cada envío se pone más lento.
    const tokensVencidos = [];
    resp.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (!r.success && (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered")) {
        tokensVencidos.push(tokens[i]);
      }
    });
    if (tokensVencidos.length > 0) {
      const batch = db.batch();
      tokensVencidos.forEach((t) => batch.delete(db.collection("staff_tokens").doc(t)));
      await batch.commit();
    }
    logger.info(`Pedido ${event.params.pedidoId}: notificación enviada a ${resp.successCount}/${tokens.length} dispositivo(s).`);
  } catch (err) {
    logger.error("Error enviando notificación push de pedido nuevo:", err);
  }
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Emisión de comprobante electrónico (SUNAT) — dormido hasta activarse
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Se dispara sola, automáticamente, cada vez que se crea una venta o un fiado con
 * comprobante.estado === 'pendiente' (ver _asignarComprobante() en core.js, que arma ese
 * bloque). No hace falta llamarla desde ningún lado del frontend.
 *
 * CRÍTICO — la venta/fiado YA está guardada en Firestore, completa, ANTES de que esto se
 * ejecute. La emisión del comprobante nunca es condición para que la venta se guarde — si
 * esto falla por cualquier motivo, la venta sigue intacta (stock descontado, caja
 * actualizada, cliente registrado), solo queda comprobante.estado = 'error' para revisar o
 * reintentar más adelante. Mismo principio ya aplicado en notificarPedidoNuevo de arriba.
 *
 * SI ALGO FALLA (comprobante.estado = 'error'): no hay reintento automático — el proveedor
 * caído por unos minutos, un dato mal configurado, etc. quedan visibles en Configuración →
 * Comprobante electrónico ("Comprobantes pendientes de revisar"), con el motivo del error y
 * un botón "Reintentar" por cada uno (ver reintentarComprobante() más abajo, y
 * _cargarComprobantesConError()/reintentarComprobante() en configuracion.js). El admin decide
 * cuándo reintentar, en vez de que el sistema lo haga solo sin que nadie se entere.
 *
 * ANTES DE DESPLEGAR ESTO EN SERIO, HACE FALTA:
 * 1. Confirmar con el proveedor elegido (ej. Nubefact) la URL exacta de su endpoint y los
 *    nombres de campo — esto sigue el formato públicamente documentado por Nubefact, pero
 *    no fue probado contra un Token de prueba real todavía (mismo caso que Izipay arriba).
 * 2. IGV: el negocio opera bajo el Nuevo RUS actualmente, que NO discrimina IGV en sus
 *    comprobantes (regimen de cuota fija, no regimen general) — el código de abajo ya
 *    distingue este caso (envía el total como no gravado bajo RUS, solo desglosa 18% de IGV
 *    para otros regímenes), pero esto tiene peso tributario real: confirmar con un contador
 *    o directo con el proveedor antes de emitir cualquier comprobante real.
 * 3. Cargar el Token como Secret de Firebase (ver arriba) y activar el interruptor en
 *    Configuración → Comprobante electrónico.
 */
async function _procesarComprobante(snap) {
  const venta = snap.data();
  // Acepta 'pendiente' (primera vez, disparado por los triggers automaticos de abajo) o
  // 'error' (reintento explicito via reintentarComprobante) — nunca se reprocesa un
  // comprobante ya 'emitido'. El trigger automatico onDocumentCreated solo reacciona a la
  // CREACION del documento, nunca a una actualizacion posterior, asi que permitir 'error'
  // aca es seguro: la unica forma de que esto se ejecute de nuevo es un reintento explicito.
  if (!venta.comprobante || (venta.comprobante.estado !== "pendiente" && venta.comprobante.estado !== "error")) return;

  const ventaRef = snap.ref;
  const cfgSnap = await db.collection("aleze").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const ce = cfg.comprobanteElectronico || {};

  if (!ce.activa) {
    // El sistema se desactivó entre que esta venta pidió número y que esta función corrió —
    // no intentar nada, dejar marcado para que el admin decida qué hacer.
    await ventaRef.update({ "comprobante.estado": "no_emitido_inactivo" }).catch(() => {});
    return;
  }

  try {
    const _esRus = cfg.regimenTributario === "RUS";
    const _total = venta.total || 0;
    // TODO: confirmar el codigo SUNAT exacto de tipo_de_igv para operaciones no gravadas
    // (RUS) contra la documentacion del proveedor — este es un valor razonable segun el
    // catalogo estandar SUNAT (17 = Operacion inafecta), no verificado contra Token real.
    const _totalGravada = _esRus ? 0 : Math.round((_total / 1.18) * 100) / 100;
    const _totalIgv = _esRus ? 0 : Math.round((_total - _total / 1.18) * 100) / 100;

    const trama = {
      operacion: "generar_comprobante",
      tipo_de_comprobante: venta.comprobante.tipo === "factura" ? 1 : 2,
      serie: venta.comprobante.serie,
      numero: venta.comprobante.numero,
      sunat_transaction: 1,
      cliente_tipo_de_documento: venta.comprobante.tipo === "factura" ? "6" : "1",
      cliente_numero_de_documento: venta.clienteRuc || "00000000",
      cliente_denominacion: venta.clienteNombre || "Cliente",
      cliente_direccion: venta.clienteDireccion || "",
      fecha_de_emision: (venta.fecha || "").split("-").reverse().join("-"), // YYYY-MM-DD → DD-MM-YYYY
      moneda: 1,
      total_gravada: _totalGravada,
      total_igv: _totalIgv,
      total: _total,
      items: (venta.items || []).map((i) => {
        const _precioItem = i.precio || 0;
        const _cantItem = i.cant || 1;
        const _valorUnit = _esRus ? _precioItem : Math.round((_precioItem / 1.18) * 100) / 100;
        const _igvItem = _esRus ? 0 : Math.round((_precioItem - _precioItem / 1.18) * _cantItem * 100) / 100;
        return {
          unidad_de_medida: "NIU",
          codigo: String(i.prodId || ""),
          descripcion: i.nombre || "",
          cantidad: _cantItem,
          valor_unitario: _valorUnit,
          precio_unitario: _precioItem,
          tipo_de_igv: _esRus ? 17 : 1,
          igv: _igvItem,
          total: Math.round(_precioItem * _cantItem * 100) / 100,
        };
      }),
    };

    // TODO: confirmar URL exacta del endpoint contra el panel/documentacion del proveedor —
    // este valor sigue el patron publico documentado, no verificado contra Token real.
    const resp = await fetch("https://api.nubefact.com/api/v1/" + (ce.rucONumero || ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token token=" + NUBEFACT_TOKEN.value(),
      },
      body: JSON.stringify(trama),
    });
    const data = await resp.json().catch(() => null);

    if (resp.ok && data && !data.errors) {
      await ventaRef.update({
        "comprobante.estado": "emitido",
        "comprobante.enlacePdf": data.enlace_del_pdf || null,
        "comprobante.emitidoTs": admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info(`Comprobante emitido para venta ${ventaRef.id}: ${trama.serie}-${trama.numero}`);
    } else {
      await ventaRef.update({
        "comprobante.estado": "error",
        "comprobante.errorMsg": (data && (data.errors || data.mensaje)) || "Respuesta no exitosa del proveedor",
      });
      logger.warn(`Comprobante no emitido para venta ${ventaRef.id}:`, data);
    }
  } catch (err) {
    logger.error("Error emitiendo comprobante:", err);
    // La venta ya esta guardada de antes — esto solo marca el comprobante como pendiente de
    // revisar, nunca revierte ni afecta stock, caja, ni el resto de la venta.
    await ventaRef.update({
      "comprobante.estado": "error",
      "comprobante.errorMsg": err.message || "Error de red al conectar con el proveedor",
    }).catch(() => {});
  }
}

exports.emitirComprobanteVenta = onDocumentCreated(
  { document: "ventas/{ventaId}", region: "southamerica-east1", secrets: [NUBEFACT_TOKEN] },
  async (event) => { await _procesarComprobante(event.data); }
);

exports.emitirComprobanteFiado = onDocumentCreated(
  { document: "fiados/{fiadoId}", region: "southamerica-east1", secrets: [NUBEFACT_TOKEN] },
  async (event) => { await _procesarComprobante(event.data); }
);

/**
 * ── reintentarComprobante ────────────────────────────────────────────────
 * Llamada explícita desde Configuración → Comprobante electrónico, cuando el admin ve un
 * comprobante en estado 'error' y toca "Reintentar". Solo staff autenticado (no anónimo,
 * mismo criterio que isAdmin() en las reglas de Firestore) — nunca callable por un cliente
 * de tienda pública. Reutiliza _procesarComprobante tal cual, sin duplicar ninguna lógica:
 * misma función que corre automáticamente al crear la venta, ahora disparada a demanda.
 */
exports.reintentarComprobante = onCall(
  { secrets: [NUBEFACT_TOKEN], region: "southamerica-east1" },
  async (request) => {
    if (!request.auth || request.auth.token.firebase.sign_in_provider === "anonymous") {
      throw new Error("No autorizado.");
    }
    const { coleccion, id } = request.data || {};
    if (!coleccion || !["ventas", "fiados"].includes(coleccion) || !id) {
      throw new Error("Datos inválidos — falta indicar la colección o el ID.");
    }
    const ref = db.collection(coleccion).doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) throw new Error("La venta/fiado indicado no existe.");
    await _procesarComprobante(snap);
    return { ok: true };
  }
);

// CRITICO: las reglas de Firestore validan que pedidoValido() tenga total > 0, pero no que
// coincida con lo que realmente cuestan los items — un cliente malicioso podria enviar items
// reales por S/100 con total: 0.01, y la regla lo aceptaria igual. Esta funcion no intenta
// recalcular el total exacto (fragil: se desincronizaria con cualquier cambio futuro a
// _tndCalcularTotal() en tienda-publica.js, que incluye combos/promociones/descuento por
// puntos/recargo de delivery). En vez de eso, compara contra el precio de CATALOGO (sin
// descuentos) de cada item, y solo marca si el total esta muy por debajo de lo que ni la
// promocion mas agresiva legitima explicaria — detecta manipulacion extrema sin generar
// falsos positivos por descuentos reales.
exports.validarTotalPedido = onDocumentCreated("pedidos_online/{pedidoId}", async (event) => {
  const pedido = event.data?.data();
  if (!pedido || !Array.isArray(pedido.items) || pedido.items.length === 0) return;

  try {
    let sumaCatalogo = 0;
    for (const item of pedido.items) {
      if (!item.prodId || !item.cant) continue;
      const prodSnap = await db.collection("productos").doc(String(item.prodId)).get();
      if (!prodSnap.exists) continue;
      sumaCatalogo += (prodSnap.data().precio || 0) * item.cant;
    }
    if (sumaCatalogo === 0) return; // sin items validos en catalogo, nada que comparar

    const UMBRAL_MINIMO = 0.4; // ningun descuento/combo legitimo baja el total a menos del 40% del precio de lista
    if (pedido.total < sumaCatalogo * UMBRAL_MINIMO) {
      await event.data.ref.set({
        totalSospechoso: true,
        totalCatalogoReferencia: Math.round(sumaCatalogo * 100) / 100
      }, { merge: true });
      logger.warn(`Pedido ${event.params.pedidoId}: total (${pedido.total}) muy por debajo del catálogo (${sumaCatalogo.toFixed(2)}) — marcado para revisión`);
    }
  } catch (e) {
    logger.error("validarTotalPedido: error", e);
  }
});

// CRITICO: con catalogos grandes (varios cientos de productos), cada visita a tienda publica
// releyendo la coleccion completa de productos se vuelve muy caro muy rapido — 1000
// productos = 1000 lecturas por visita, agotando la cuota diaria gratuita con apenas unas
// decenas de visitas reales, sin necesitar ningun bot de por medio. La solucion no puede ser
// un cache por tiempo fijo: el stock debe reflejarse al instante en cuanto cambia (fricción
// real con el cliente si compra algo que ya no hay), pero durante horas sin ninguna venta ni
// cambio, no tiene sentido releer todo una y otra vez para cada visitante.
//
// Estas 2 funciones observan directamente la fuente de verdad (productos y categorias), sin
// importar desde donde vino el cambio — una venta, una merma, una edicion de catalogo,
// cualquier cosa — y actualizan un documento liviano con la hora exacta del ultimo cambio
// real. tienda-publica.js lee ese documento (1 lectura barata) antes de decidir si vale la
// pena releer los productos completos, o si puede reutilizar lo que el navegador ya tiene
// guardado. Durante tiempos muertos, el marcador no cambia, y el cache sirve indefinidamente
// — en el instante en que algo cambia, se dispara la actualizacion y el proximo visitante
// (o el mismo, si vuelve a entrar) ve el dato fresco de inmediato.
exports.marcarCatalogoActualizado_productos = onDocumentWritten("productos/{prodId}", async (event) => {
  try {
    await db.collection("aleze").doc("catalogo_meta").set({
      ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    logger.error("marcarCatalogoActualizado_productos: error", e);
  }
});

exports.marcarCatalogoActualizado_categorias = onDocumentWritten("aleze/db_productos", async (event) => {
  // Las categorias viven dentro de aleze/db_productos (campo 'categorias'), no en su propia
  // coleccion — mismo documento que ya se re-escribe completo cada vez que se edita una
  // categoria o la configuracion de tienda. Mismo mecanismo, misma razon.
  try {
    await db.collection("aleze").doc("catalogo_meta").set({
      ultimaActualizacion: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    logger.error("marcarCatalogoActualizado_categorias: error", e);
  }
});

// CRITICO: el rol de cada usuario vivia solo en una variable de JavaScript en el navegador
// (currentRole), leida una vez al iniciar sesion y nunca reverificada contra el servidor. Las
// reglas de Firestore solo distinguian "autenticado" de "anonimo" — cualquier staff con
// sesion valida (vendedor incluido) podia, en teoria, escribir directo a Firestore acciones
// reservadas a admin, sin que la regla lo notara. Esta funcion asigna el rol real como custom
// claim en el propio token de autenticacion — un dato que solo el servidor puede escribir,
// nunca el cliente — para que las reglas de Firestore puedan verificarlo de verdad.
//
// Callable por CUALQUIER staff autenticado (no solo admin) — esto es seguro a proposito:
// resuelve el problema de arranque (la primera vez que se ejecuta, nadie tiene el claim
// todavia, asi que exigir "solo admin ya verificado" dejaria un candado sin llave). El rol
// asignado a cada usuario SIEMPRE viene de lo que ya esta en usuariosStaff (Firestore, editable
// solo por admin desde el panel de Configuracion) — nunca de lo que pide quien llama la
// funcion. Un vendedor no puede auto-asignarse admin llamando esto, porque la funcion ignora
// por completo cualquier input del llamador sobre que rol quiere.
exports.sincronizarRolesStaff = onCall(async (request) => {
  if (!request.auth || request.auth.token.firebase.sign_in_provider === "anonymous") {
    throw new Error("No autorizado.");
  }
  logger.info(`sincronizarRolesStaff: llamado por uid=${request.auth.uid} email=${request.auth.token.email || '(sin email en token)'}`);

  const configSnap = await db.collection("aleze").doc("db_productos").get();
  // CRITICO: usuariosStaff vive dentro de config (db_productos.config.usuariosStaff), no en
  // la raiz del documento — fbGuardarProductos() (cliente) siempre lo escribio anidado asi.
  // Buscarlo en la raiz (como estaba antes) siempre encontraba 0 usuarios, sin importar
  // cuantos reintentos se hicieran del lado del token — el rol nunca se llegaba ni a intentar
  // asignar, porque el bucle de abajo nunca tenia nada que procesar. Confirmado con evidencia
  // real de logs: "usuariosStaff encontrados = 0" en cada corrida, pese a que el documento
  // real si tenia los 3 usuarios — solo que en config.usuariosStaff, no en la raiz.
  const usuariosStaff = configSnap.exists ? (configSnap.data().config?.usuariosStaff || []) : [];
  logger.info(`sincronizarRolesStaff: usuariosStaff encontrados = ${usuariosStaff.length}`);

  const resultados = [];
  for (const u of usuariosStaff) {
    if (!u.email || !u.rol) { logger.warn(`sincronizarRolesStaff: entrada sin email/rol, se salta: ${JSON.stringify(u)}`); continue; }
    try {
      const userRecord = await admin.auth().getUserByEmail(u.email);
      await admin.auth().setCustomUserClaims(userRecord.uid, { role: u.rol });
      // Verificacion inmediata: releer el usuario justo despues de asignarle el rol, para
      // confirmar si el servidor YA lo tiene grabado en este mismo instante — aisla si el
      // problema es de propagacion hacia el token del navegador, o si nunca se guardo.
      const userVerificado = await admin.auth().getUser(userRecord.uid);
      const esQuienLlama = userRecord.uid === request.auth.uid;
      logger.info(`sincronizarRolesStaff: ${u.email} -> uid=${userRecord.uid}${esQuienLlama ? ' (ES quien llama)' : ''}, rol asignado=${u.rol}, claims verificados justo despues=${JSON.stringify(userVerificado.customClaims)}`);
      resultados.push({ email: u.email, rol: u.rol, ok: true });
    } catch (e) {
      logger.warn(`sincronizarRolesStaff: no se pudo sincronizar ${u.email}`, e.message);
      resultados.push({ email: u.email, rol: u.rol, ok: false, error: e.message });
    }
  }
  logger.info(`sincronizarRolesStaff: TERMINO — ${resultados.filter(r=>r.ok).length}/${resultados.length} sincronizados ok`);
  return { ok: true, resultados };
});

// CRITICO: App Check (activado en una ronda anterior) protege contra bots puros hablando
// directo con la API de Firestore, pero no contra un navegador real automatizado (por ejemplo
// con Puppeteer) que si pasa esa verificacion. Esta funcion es la segunda capa: cuenta cuantos
// pedidos llegaron del mismo telefono en una ventana de tiempo corta, usando createTime — el
// metadato real que Firestore asigna en el servidor, inmune a cualquier manipulacion del
// cliente (a diferencia de fecha/hora, que son strings que el cliente envia). Ningun cliente
// real genera varios pedidos en minutos - si eso ocurre, se marca para revision, sin bloquear
// nada (mismo criterio que totalSospechoso: el staff decide con el contexto completo antes de
// confirmar, no se rechaza el pedido automaticamente).
exports.detectarPedidosSospechosos = onDocumentCreated("pedidos_online/{pedidoId}", async (event) => {
  const pedido = event.data?.data();
  if (!pedido || !pedido.telefono) return;

  try {
    const VENTANA_MINUTOS = 5;
    const UMBRAL = 3; // mas de 3 pedidos del mismo telefono en la ventana es sospechoso

    const snap = await db.collection("pedidos_online").where("telefono", "==", pedido.telefono).get();
    const ahora = Date.now();
    const recientes = snap.docs.filter(d => (ahora - d.createTime.toMillis()) <= VENTANA_MINUTOS * 60 * 1000);

    if (recientes.length > UMBRAL) {
      await event.data.ref.set({
        pedidosRecientesSospechoso: true,
        pedidosRecientesCantidad: recientes.length
      }, { merge: true });
      logger.warn(`Pedido ${event.params.pedidoId}: ${recientes.length} pedidos del mismo telefono (${pedido.telefono}) en los últimos ${VENTANA_MINUTOS} minutos — marcado para revisión`);
    }
  } catch (e) {
    logger.error("detectarPedidosSospechosos: error", e);
  }
});
