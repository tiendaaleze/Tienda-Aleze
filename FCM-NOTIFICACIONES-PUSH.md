# Notificaciones push reales (FCM) — guía de activación

**Estado: código completo, esperando 3 pasos manuales tuyos.** Sin estos 3 pasos, todo lo
construido queda dormido — no rompe nada, simplemente no hace nada todavía.

---

## Qué se construyó

Hasta ahora, avisar de un pedido nuevo dependía de `new Notification()` disparado directo
desde `index.html` — funciona, pero **solo si la pestaña está abierta y activa** en ese
momento. Si el celular está bloqueado o la app cerrada, ese aviso nunca sale.

Lo nuevo (Firebase Cloud Messaging) resuelve exactamente eso: cuando llega un pedido, una
Cloud Function en el servidor le manda un push a cada dispositivo de staff registrado, y el
Service Worker (que sigue "vivo" aunque la pestaña esté cerrada) es quien muestra la
notificación. Es la misma tecnología detrás de las notificaciones de WhatsApp o Gmail en el
celular.

**Costo:** FCM en sí es gratis, sin límite. Lo único que exige es el plan Blaze (que ya
tenés activo) porque usa una Cloud Function — con el volumen de pedidos de un minimarket, el
uso real se mantiene muy por debajo de la capa gratuita de Cloud Functions.

---

## Paso 1 — Obtener la clave VAPID (5 minutos)

1. Andá a [Firebase Console](https://console.firebase.google.com) → proyecto `tienda-aleze`.
2. ⚙️ (ícono de engranaje, arriba a la izquierda) → **Configuración del proyecto**.
3. Pestaña **Cloud Messaging**.
4. Bajá hasta **"Certificados push web"**.
5. Si no hay ninguno todavía, click en **"Generar par de claves"**.
6. Copiá la clave larga que aparece (empieza con letras/números, no tiene espacios).

## Paso 2 — Pegar la clave en el código

Buscá en `index.html` la línea:
```js
const VAPID_KEY = 'PENDIENTE';
```
Reemplazá `'PENDIENTE'` por la clave que copiaste en el paso 1, entre comillas. Es una clave
**pública** — no pasa nada si queda visible en el código, es el mismo criterio que la clave
de reCAPTCHA que ya está ahí al lado.

## Paso 3 — Reglas de Firestore (agregar, no reemplazar)

Andá a Firebase Console → Firestore Database → Reglas, y agregá este bloque dentro de
`match /databases/{database}/documents { ... }`, junto a los demás `match`:

```
match /staff_tokens/{token} {
  allow read, write: if isAdmin();
}
```

Publicá los cambios.

## Paso 4 — Desplegar la Cloud Function

Necesitás tener el CLI de Firebase instalado (`npm install -g firebase-tools`) y estar
logueado (`firebase login`). Desde la carpeta del proyecto:

```bash
firebase deploy --only functions:notificarPedidoNuevo
```

Vas a ver un mensaje de éxito con el nombre de la función desplegada. Si es la primera vez
que desplegás una función en este proyecto, puede pedirte confirmar el plan Blaze — ya lo
tenés activo, así que solo hay que aceptar.

---

## Cómo probarlo

1. Con los 4 pasos hechos, recargá la app, iniciá sesión como staff.
2. El navegador te va a pedir permiso para notificaciones — aceptalo.
3. Revisá en la consola (F12) que aparezca `[FCM] Dispositivo registrado para
   notificaciones push.`
4. Cerrá la pestaña (o bloqueá el celular si estás probando en el teléfono).
5. Desde otro dispositivo (o la tienda pública), hacé un pedido de prueba.
6. En unos segundos debería aparecer la notificación del sistema operativo, aunque la app
   esté cerrada.

## Si algo no aparece

- Revisá los logs de la función en Firebase Console → Functions → `notificarPedidoNuevo` →
  Registros. Si dice "no hay dispositivos registrados", el paso 1-2 no se completó bien en
  ese dispositivo específico, o nunca se le dio permiso.
- Los navegadores de escritorio y Android soportan esto bien. **iOS (iPhone) solo lo soporta
  si la app está instalada como PWA** desde el ícono de compartir de Safari — no funciona
  abierta desde el navegador normal en iPhone, es una limitación de Apple, no de este código.

## Qué NO se tocó

`notificarNuevoPedido()` (el aviso mientras la pestaña está abierta) sigue funcionando igual
que antes — esto es un sistema adicional para cuando la app está cerrada, no un reemplazo.
