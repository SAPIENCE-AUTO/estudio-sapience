# Encargo para la sesión del Hub: botón «Crear links de sesión»

Se pega tal cual al abrir una sesión nueva en la carpeta `~/hub-sapience`. El contrato completo está en `docs/integracion-hub.md` de este mismo repositorio (`~/estudio-sapience`).

---

Tarea: en el Hub, en cada evento del calendario, un botón para iniciar la sesión en Talks.

Contexto: Talks es una app aparte (`~/estudio-sapience`, servicio propio en Render, `talks.mx`) para correr sesiones en vivo con participantes sobre LiveKit. Se desarrolla en su propia sesión y NO se edita desde una sesión del Hub. El Hub ya tiene Salas de observación (`observation_sessions`, `provisionObservationSession`, `ObservationRoomPanel`) con una transmisión de Mux por evento del calendario; Talks reemplazará a Zoom como la fuente del video que ve el cliente. Todo texto para Sergio va en español llano, sin jerga y sin «·». Commits solo cuando él diga «sube», con datos inventados y sin llaves reales. El árbol de trabajo del Hub tiene muchos cambios sin subir de otras sesiones: toca solo los archivos necesarios.

Contrato (API de Talks, seguridad, qué guardar): `/Users/sergiovelasco/estudio-sapience/docs/integracion-hub.md`. Léelo primero; del lado de Talks está hecho y probado.

Qué hacer en el Hub:

1. Un botón en el evento del calendario que SOLO aparece si el evento ya está guardado (tiene su id). Primera vez: «Crear links de sesión». Después: «Abrir en Talks» (abre `linkEquipo`) y muestra los links. Apretarlo dos veces NO crea nada doble.
2. Endpoint nuevo (un archivo por operación en `src/api/`, `authenticated: true`, zod en entrada y salida): reutiliza `provisionObservationSession(calendarEventId)` para crear o recuperar la transmisión de Mux, y luego llama a Talks `POST {TALKS_URL}/api/v1/sesiones` con `Authorization: Bearer {TALKS_API_KEY}` y cuerpo `{ nombre, externoId: calendarEventId, muxStreamKey, observacionUrl }`. Otro endpoint (o el mismo) para consultar sin crear: `GET {TALKS_URL}/api/v1/sesiones/evento/{calendarEventId}`.
3. Guardar junto a la sala de observación: el id de la sesión de Talks, `linkEquipo` y `linkParticipantes`. Es un cambio de esquema: sigue las convenciones del Hub (`server/generate.py` / `EXTRA_TABLES` y un script en `server/scripts/` que NO se ejecuta solo; no edites a mano los archivos generados). No ejecutes migraciones contra la base real: déjalas escritas y dile a Sergio cómo correrlas.
4. Mostrar los cuatro datos con botón de copiar: link del equipo (Talks), link de participantes (Talks), link de observación del cliente (el `/s/<slug>` que ya existe) y los datos de la transmisión de Mux (lo que ya muestra `ObservationRoomPanel`).
5. Variables nuevas: `TALKS_URL` (`https://www.talks.mx`, con el `www`: las llamadas entre sistemas no pueden pasar por la redirección de `talks.mx`) y `TALKS_API_KEY` (la misma `HUB_API_KEY` que ya está en Render del lado de Talks). Documéntalas en el CLAUDE.md del Hub y en `.env.example` si existe; nunca pongas la llave real en un archivo versionado ni en el chat.

Seguridad (importante): `mux_stream_key` es la única credencial que permite transmitir a esa sala. El Hub no la pone en URLs ni en registros, y solo se la manda a Talks por ese POST. Talks nunca la devuelve.

Cómo probar sin tocar producción: levanta un servidor de mentira que imite las dos rutas de Talks (o usa Talks en local si Sergio lo enciende) y verifica: la primera llamada crea, la segunda devuelve la misma (`yaExistia: true`), el botón no aparece en un evento sin guardar, y los errores de Talks (400, 401, no disponible) se muestran en español llano sin romper la pantalla. No llames al Talks real con llaves reales sin que Sergio lo diga.

Hecho cuando: el botón aparece solo en eventos guardados, crea y muestra los cuatro datos, es idempotente, está probado contra el servidor de mentira, y el resumen para Sergio dice en español llano qué cambió y qué pasos le tocan a él (migración, variables de entorno). Sin commit hasta que Sergio diga «sube». Si Talks necesita un cambio, repórtalo; no edites `~/estudio-sapience` desde aquí.
