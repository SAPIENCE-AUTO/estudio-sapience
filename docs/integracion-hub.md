# Integración Hub ↔ Talks (contrato)

Para quien programe la parte del **Hub**. Todo lo de esta carpeta (Talks) ya está hecho y probado; aquí está lo que el Hub debe mandar y lo que Talks contesta.

## Qué se quiere

En cada **evento del calendario** del Hub, un botón que inicia la sesión en Talks:

1. El botón aparece **solo si el evento ya está guardado** (tiene su identificador).
2. La primera vez dice **«Crear links de sesión»**: el Hub crea la transmisión de Mux (lo que ya hace `provisionObservationSession`) y le pide a Talks la sesión, mandándole la llave. Muestra los cuatro datos con botón de copiar:
   - Link del **equipo** (Talks): `linkEquipo`
   - Link de **participantes** (Talks): `linkParticipantes`
   - Link de **observación del cliente** (Hub): el que ya existe (`/s/<slug>`)
   - Datos de la **transmisión** (Mux): el que ya muestra `ObservationRoomPanel`
3. Después dice **«Abrir en Talks»** (abre `linkEquipo`) y muestra los mismos links. Apretar el botón otra vez NO crea otra sesión.
4. En Talks, el botón **EN VIVO** transmite el escenario a la llave de Mux de ese evento; el cliente lo ve en su página de observación. Mux guarda la transmisión como grabación (`new_asset_settings`).

## Seguridad

- El Hub llama a Talks con la llave compartida: `Authorization: Bearer <HUB_API_KEY>`. Es la misma que está en Render (servicio `talks`, variable `HUB_API_KEY`). En el Hub va en dos variables nuevas: `TALKS_URL` (`https://www.talks.mx`: con el `www`, porque las llamadas entre sistemas NO pueden pasar por la redirección de `talks.mx` a `www.talks.mx`: pierde la llave y cambia el POST por un GET) y `TALKS_API_KEY`.
- **La llave de Mux (`mux_stream_key`) es la única credencial que permite transmitir a esa sala.** Talks la guarda solo en el servidor (base de datos, con seguridad por filas) y **nunca** la devuelve: ni en las respuestas, ni en el estado que ven las pantallas, ni en los registros. El Hub tampoco debe ponerla en URLs ni en registros.
- El botón de «Crear links» debe pedir sesión iniciada en el Hub (igual que `createObservationStream`).

## API de Talks

### Crear (o recuperar) la sesión de un evento

```
POST {TALKS_URL}/api/v1/sesiones
Authorization: Bearer {TALKS_API_KEY}
Content-Type: application/json

{
  "nombre": "Grupo 1 Aperol",                       // obligatorio, hasta 120 caracteres
  "externoId": "<id del evento del calendario>",    // el id del evento; con él, apretar dos veces devuelve la misma sesión
  "muxStreamKey": "<mux_stream_key de la sala>",    // letras, números y guiones (8 a 100); sin esto no se puede transmitir
  "observacionUrl": "https://.../s/<slug>"          // opcional, solo https; solo informativo
}
```

Respuesta `201` (sesión nueva) o `200` (ya existía para ese `externoId`):

```json
{
  "id": "s1a2b3c4d5e",
  "nombre": "Grupo 1 Aperol",
  "codigo": "0123456789ab",
  "linkParticipantes": "https://talks.mx/p/0123456789ab",
  "linkEquipo": "https://talks.mx/equipo/s1a2b3c4d5e",
  "externoId": "<id del evento>",
  "yaExistia": false,
  "transmision": "lista"            // «lista» si Talks tiene una llave de Mux para esta sesión; «sin-llave» si no
}
```

- Si el Hub vuelve a llamar con el mismo `externoId` y una **llave o nombre distintos** (la regeneró o renombró el evento), Talks **actualiza** la sesión existente.
- Si el Hub llama sin `muxStreamKey` y la sesión ya tenía una, **conserva** la que tenía.
- Una sesión **terminada** ya no cuenta: si el evento vuelve a empezar, se crea una nueva.
- Errores: `400` (datos inválidos, por ejemplo una llave con formato raro o una URL que no es https), `401` (falta o está mal la llave del Hub).

### Consultar la sesión de un evento

```
GET {TALKS_URL}/api/v1/sesiones/evento/{externoId}
Authorization: Bearer {TALKS_API_KEY}
```

Misma respuesta que arriba (con `yaExistia: true`), o `404` si el evento todavía no tiene sesión. Sirve para decidir si el botón dice «Crear links de sesión» o «Abrir en Talks» sin crear nada.

### Acceso directo: «Abrir en Talks» sin volver a pedir el correo

El Hub y Talks son dos sitios distintos y el navegador no comparte el inicio de sesión entre sitios, así que sin esto Talks pide el correo aunque la persona ya esté dentro del Hub. Solución: el Hub, que ya sabe quién es, le pide a Talks un **pase de un solo uso** para ese correo.

```
POST {TALKS_URL}/api/v1/acceso-equipo
Authorization: Bearer {TALKS_API_KEY}
Content-Type: application/json

{
  "email": "ana@empresa.com",       // el correo de quien aprieta el botón, tomado de la sesión YA verificada del Hub (nunca de lo que mande el navegador)
  "nombre": "Ana López",            // opcional, hasta 60; si falta, Talks lo arma con el correo
  "sesionId": "s1a2b3c4d5e"         // opcional: el `id` de la sesión de Talks (`talks_session_id`); si falta, la persona llega al inicio de Talks
}
```

Respuesta `201`: `{ "url": "https://www.talks.mx/entrar-hub#c=…", "venceEnSegundos": 60 }`. El Hub abre esa dirección y la persona cae directo en la consola de esa sesión.

- Errores: `401` (llave mala), `403` con `error: "SIN_ACCESO"` (ese correo NO está en la lista del equipo de Talks, `EQUIPO_PERMITIDO` de Render), `404` (la sesión no existe), `400` (datos mal formados). El Hub NO debe quedarse atascado: ante cualquier error abre el `linkEquipo` normal (Talks pedirá el correo) y lo dice en español llano.
- **El pase vale 60 segundos y sirve UNA sola vez.** Pedir uno nuevo en cada clic; no guardarlo, no copiarlo para otras personas, no escribirlo en registros (ni la `url` ni la respuesta). El botón de copiar el «link del equipo» sigue dando el `linkEquipo` normal (sin pase): quien lo reciba entra con su correo.
- Va en la parte `#` de la dirección a propósito: esa parte no llega a ningún servidor, ni a los registros, ni al `referer`.
- Los navegadores bloquean ventanas que se abren después de una espera: abrir primero una ventana en blanco con el clic (`const v = window.open('', '_blank')`) y, cuando llegue la `url`, poner `v.location.href = url`; si Talks falla, poner ahí el `linkEquipo`.
- Qué hace Talks: cambia el pase por una **sesión del equipo propia de Talks** (firmada, 12 horas). Nunca se le pasa la sesión del Hub ni sus tokens. La lista `EQUIPO_PERMITIDO` se vuelve a revisar en cada llamada: quien salga de la lista pierde el acceso aunque su sesión no haya vencido.
- Esta llamada SOLO acepta la llave del Hub (no la sesión de una persona), y la llave ahora abre la puerta del equipo además de crear sesiones: guardarla solo en el servidor del Hub, como hasta hoy.

## Lo que debe guardar el Hub

Junto a la sala de observación del evento (`observation_sessions`): el `id` de la sesión de Talks, `linkEquipo` y `linkParticipantes` (columnas nuevas, por ejemplo `talks_session_id`, `talks_link_equipo`, `talks_link_participantes`). La llave de Mux ya la tiene.

## Pendiente de este lado (Talks)

- El botón **EN VIVO** (transmisión a Mux) y los **highlights**: en construcción; el Hub no necesita nada más para que funcionen, solo haber mandado la llave al crear la sesión.
- El **chat con observadores** (el de la página de observación del Hub): se conectará después.
