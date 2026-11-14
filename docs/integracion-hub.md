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

## Lo que debe guardar el Hub

Junto a la sala de observación del evento (`observation_sessions`): el `id` de la sesión de Talks, `linkEquipo` y `linkParticipantes` (columnas nuevas, por ejemplo `talks_session_id`, `talks_link_equipo`, `talks_link_participantes`). La llave de Mux ya la tiene.

## Pendiente de este lado (Talks)

- El botón **EN VIVO** (transmisión a Mux) y los **highlights**: en construcción; el Hub no necesita nada más para que funcionen, solo haber mandado la llave al crear la sesión.
- El **chat con observadores** (el de la página de observación del Hub): se conectará después.
