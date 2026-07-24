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
