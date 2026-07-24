# Facturación electrónica / SUNAT — referencia completa (dormido)

**Estado: NO implementado, a propósito.** Este documento existe para que, sin importar cuánto
tiempo pase antes de retomarlo, se pueda avanzar directo sin tener que reconstruir el
razonamiento desde cero. Cubre el camino correcto, por qué se descartaron las alternativas, y
exactamente qué falta tocar cuando se decida activarlo.

---

## 1. La pregunta de fondo, respondida

**¿Se puede construir la emisión de boletas/facturas electrónicas dentro de este sistema,
como se hizo con el resto?** No es recomendable, y no es lo que hacen los negocios reales en
Perú. La razón no es de dificultad de programación — es que SUNAT exige que cada comprobante
se **valide y reporte a sus propios servidores**, con firma digital y un formato XML específico
(UBL 2.1), casi en tiempo real. Un comprobante que no llegó a reportarse a SUNAT correctamente
no es un bug de software — es un problema fiscal real para el negocio.

**El camino correcto:** contratar un **PSE (Proveedor de Servicios Electrónicos) autorizado por
SUNAT** — ejemplos con planes para negocios chicos: Nubefact, Efact, Bizlinks, Facturador SUNAT.
Estos proveedores:
- Ya están homologados por SUNAT (no hay que tramitar nada de cero).
- Exponen una API — este sistema les manda los datos de la venta, ellos devuelven el
  comprobante ya validado (PDF, XML, y la constancia de recepción de SUNAT).
- Se encargan de la numeración correlativa correcta (ver sección 4, es más importante de lo
  que parece).

Es el mismo patrón que ya se usó con Izipay para pagos: este sistema arma la data, un proveedor
especializado hace el trámite real. No se reinventa la rueda regulatoria.

---

## 2. Boleta vs. Factura — la diferencia que importa acá

- **Boleta de venta electrónica**: para venta a consumidor final (persona natural, no necesita
  crédito fiscal). Es el documento que un minimarket como este emite casi siempre.
- **Factura electrónica**: cuando el comprador es una empresa/negocio que va a usar la compra
  como gasto deducible — requiere el RUC del comprador.

Para Tienda Aleze, la mayoría de ventas van a ser boletas. Factura solo si un cliente
específico la pide y da su RUC — hay que decidir, cuando se active esto, si se ofrece esa
opción desde el ticket o se maneja aparte.

---

## 3. Qué existe hoy en el sistema, y cómo se conecta

- `mostrarTicket(venta)` — genera el HTML del ticket visual actual, ya distingue venta pagada
  de fiado pendiente (ver commit de fiados con ticket).
- El objeto `venta` (construido en `procesarVenta()`, `mobProcesarVenta()`, `cobrarFiado()`,
  `mobCobrarFiado()`) ya tiene: `id`, `fecha`, `hora`, `cajero`, `items`, `subtotal`,
  `descuento`, `total`, `metodo`, `clienteId`, `sedeId`.
- **Lo que falta en el objeto venta para un comprobante real:**
  - `tipoComprobante` (boleta / factura / ninguno — hoy no existe el concepto)
  - DNI o RUC del cliente (hoy `DB.clientes` no pide ninguno de los dos)
  - Dirección fiscal del negocio por sede, si SUNAT lo requiere distinto por local
  - Desglose de IGV (hoy el precio ya es el precio final, sin descomponer base + impuesto)

Ninguno de estos campos existe hoy — agregar campos vacíos "por si acaso" antes de tener
proveedor elegido generaría mantenimiento sin beneficio real. Se agregan cuando se integre.

---

## 4. El problema técnico que hay que recordar: numeración correlativa

SUNAT exige que cada serie de comprobantes (ej. B001) sea **estrictamente correlativa, sin
saltos**. Este sistema genera IDs locales (`getId()`, basado en tiempo) pensados para
funcionar **sin conexión** — dos dispositivos offline podrían generar ventas "al mismo tiempo"
sin coordinarse entre sí.

**Por eso la numeración NUNCA debe generarse localmente en este sistema.** La forma correcta:
el PSE (Nubefact, Efact, etc.) asigna el número real cuando recibe la venta vía su API — ellos
son el único punto centralizado y siempre-online, así que son quienes pueden garantizar
correlatividad sin huecos. Este sistema solo le manda "emití un comprobante para esta venta" y
guarda el número que el proveedor devuelve como referencia — nunca lo inventa.

Esto también resuelve el tema de las 2 sedes: cada sede puede tener su propia serie
(B001 = Sede I, B002 = Sede II, por ejemplo) configurada del lado del proveedor, sin que este
sistema tenga que coordinar nada entre dispositivos.

---

## 5. Diseño de la integración cuando se elija proveedor

Mismo patrón arquitectónico que Izipay (`functions/index.js` en este mismo repo, sección de
pasarela de pago — revisar esa implementación como referencia de estilo antes de escribir esta):

1. **Cloud Function `emitirComprobante`** (nueva, no existe todavía):
   - Recibe el `ventaId`.
   - Lee la venta real de Firestore (`ventas/{id}`) — nunca confía en datos que mande el
     navegador directamente, mismo criterio que con los pagos.
   - Arma el payload que el PSE elegido espera (cada proveedor tiene su propio formato — hay
     que revisar la documentación del que se contrate, no asumir que todos son iguales).
   - Llama a la API del PSE con la llave privada (cargada como Secret de Firebase, nunca en
     Firestore ni en el código — mismo criterio que la llave privada de Izipay).
   - Guarda la respuesta (número de comprobante, link al PDF, XML, estado) en Firestore.

2. **Colección nueva en Firestore**: `comprobantes/{id}` — separada de `ventas/{id}` a
   propósito, para no mezclar el registro interno de la venta con el documento fiscal formal.
   Campos mínimos: `ventaId`, `sedeId`, `tipoComprobante`, `numero` (el que devuelve el PSE,
   nunca uno generado acá), `estado` (emitido/error), `urlPdf`, `urlXml`, `fechaEmision`.

3. **Reglas de Firestore para `comprobantes`**: mismo patrón que el resto —
   `allow read, write: if isAdmin();` — la Cloud Function usa el Admin SDK así que no depende
   de estas reglas para escribir, pero sí aplican para lectura/consulta desde el sistema.

4. **Config dormida** (mismo patrón que `DB.config.pasarelaPago`):
   ```js
   facturacion: { activa: false, proveedor: '', rucNegocio: '', serieBoletaI: '', serieBoletaII: '' }
   ```

5. **En el ticket/checkout**: cuando `facturacion.activa` sea `true`, agregar la opción
   "Emitir boleta" (o automatizarlo en cada venta, decisión pendiente para cuando se active) —
   llama a la Cloud Function, espera el número real, lo muestra en el ticket junto con el QR
   que SUNAT exige en el comprobante impreso.

---

## 6. Ticket para tiketera térmica futura — separado de SUNAT, pero relacionado

Esto es un tema de **hardware e impresión**, no de facturación en sí — se puede resolver
independientemente de si se activa SUNAT o no:

- Impresoras térmicas de recibo usan ancho fijo: 58mm o 80mm (hay que confirmar cuál se va a
  comprar antes de programar el formato).
- No se puede depender del CSS del navegador para esto — normalmente se usa **ESC/POS**
  (el protocolo estándar de impresoras térmicas) o se imprime un PDF con dimensiones exactas.
- La conexión típica es por Bluetooth o USB al dispositivo — eso requiere una librería
  específica del lado del navegador/app, no algo que se resuelva solo con HTML.
- El ticket actual (`mostrarTicket()`) ya tiene toda la INFORMACIÓN necesaria (productos,
  precios, fidelización) — lo que falta es el FORMATO de salida para una impresora real, no el
  contenido.

**Cuando se compre la impresora real**, retomar desde acá: confirmar modelo y ancho, y recién
ahí definir si se integra vía ESC/POS directo o vía una app puente (muchas impresoras térmicas
económicas en Perú vienen con su propia app que recibe comandos por Bluetooth).

---

## 7. Checklist concreto para cuando se retome esto

1. [ ] Elegir PSE (Nubefact es el más usado por negocios chicos en Perú — comparar precios y
      planes antes de decidir, pueden haber cambiado desde que se escribió esto).
2. [ ] Contratar el plan, obtener credenciales de API (usuario/token, distinto por proveedor).
3. [ ] Confirmar el RUC del negocio y las series que va a usar cada sede.
4. [ ] Decidir: ¿DNI/RUC del cliente se pide siempre, opcional, o solo si el cliente lo pide?
5. [ ] Avisar a Claude (o a quien retome esto) con las credenciales — nunca pegarlas directo en
      el chat como texto plano si se puede evitar, usar Secrets de Firebase.
6. [ ] Implementar la Cloud Function `emitirComprobante` siguiendo la sección 5.
7. [ ] Agregar la colección `comprobantes` y sus reglas de Firestore.
8. [ ] Conectar el botón "Emitir boleta" en el ticket, dormido detrás de
      `DB.config.facturacion.activa`.
9. [ ] Probar con una venta real de bajo monto antes de usarlo en serio — los PSE normalmente
      tienen un ambiente de pruebas (sandbox) separado del de producción, usarlo primero ahí.

---

## 8. Lo que NO hay que hacer, aunque parezca más rápido

- No generar el número de boleta localmente "para no depender del proveedor" — rompe la
  correlatividad exigida por SUNAT en cuanto haya 2 sedes u operación offline.
- No intentar armar el XML UBL a mano sin un proveedor — es un formato extenso y con reglas de
  validación que cambian; los PSE existen exactamente para no tener que mantener esto.
- No activar `facturacion.activa` en producción sin haber probado en el ambiente sandbox del
  proveedor primero.
