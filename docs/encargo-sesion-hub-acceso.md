# Encargo para la sesión del Hub: «Abrir en Talks» sin volver a pedir el correo

Se pega tal cual en la sesión de Claude de la carpeta `~/hub-sapience`. El contrato está en `docs/integracion-hub.md` de `~/estudio-sapience` (sección «Acceso directo»); el lado de Talks ya está hecho y probado.

---

Tarea: que el botón «Abrir en Talks» (en la ventana del evento y en la fila de la lista del calendario) deje pasar directo a quien ya inició sesión en el Hub, sin pedirle su correo otra vez en Talks.

Contexto: Talks es una app aparte (`~/estudio-sapience`, `www.talks.mx`) que NO se edita desde una sesión del Hub. Hoy «Abrir en Talks» abre el `linkEquipo` y Talks pide el correo (enlace por correo) porque son dos sitios distintos y el navegador no comparte el inicio de sesión entre ellos. Todo texto para Sergio va en español llano, sin jerga y sin «·». Commits solo cuando él diga «sube», sin llaves reales en archivos ni en el chat. El árbol de trabajo del Hub tiene muchos cambios de otras sesiones: toca solo lo necesario.

Qué hacer en el Hub:

1. Endpoint nuevo en `src/api/` (un archivo por operación, `authenticated: true`, zod en entrada y salida), por ejemplo `getTalksAccessLink`. Entrada: el id del evento del calendario. Con la sesión YA verificada del Hub toma el correo de `context.user.email` (NUNCA un correo que mande el navegador). IMPORTANTE: Talks NO tiene otra lista de quién puede entrar para quien llega con el pase; responde el Hub. Cualquier persona dada de alta en el Hub que pase por este endpoint entrará a Talks (consola, crear y abrir sesiones). Si algún día solo ciertos roles deben usar Talks, el filtro se pone aquí, en el Hub. Con ese correo, busca el `talks_session_id` guardado en la sala de observación del evento, y llama a Talks: `POST {TALKS_URL}/api/v1/acceso-equipo` con `Authorization: Bearer {TALKS_API_KEY}` y cuerpo `{ email, nombre (opcional), sesionId }`. Devuelve `{ url }` a la pantalla.
2. El botón «Abrir en Talks» (los DOS lugares: `TalksSessionPanel.tsx` y `TalksFilaCell.tsx` / `TalksFilaVista.tsx`) llama a ese endpoint y abre `url`. Para que el navegador no bloquee la ventana: abrir primero una ventana en blanco en el clic (`const v = window.open('', '_blank')`) y, cuando llegue la `url`, poner `v.location.href = url`.
3. Si Talks falla (404, 401, no disponible o sin respuesta en unos 8 segundos), NO se queda atascado: abre el `linkEquipo` de siempre en esa misma ventana y muestra un aviso en español llano, por ejemplo «No pudimos entrar directo a Talks; te va a pedir tu correo».
4. El pase vale 60 segundos y sirve UNA vez: pedir uno nuevo en cada clic; no guardarlo en la base, no cachearlo, no ponerlo en registros (ni la `url` ni el cuerpo de la respuesta). Los botones de copiar el link del equipo siguen copiando el `linkEquipo` normal (sin pase), porque ese link es para compartirlo.
5. No hay variables nuevas: ya existen `TALKS_URL` (`https://www.talks.mx`) y `TALKS_API_KEY`. Documenta el endpoint en el CLAUDE.md del Hub en la sección de Talks.

Pruebas (sin tocar producción): extender el servidor de mentira de Talks que ya usaste con la ruta `POST /api/v1/acceso-equipo` y verificar: el correo que sale hacia Talks es el de la sesión del Hub y no uno mandado por el navegador; con la llave correcta devuelve `{ url }` y se abre; si el de mentira contesta 403, 404 o se cae, se abre el `linkEquipo` con el aviso; no se escribe la `url` en registros; el botón sigue sin aparecer en un evento sin guardar. No llames al Talks real con llaves reales sin que Sergio lo diga.

Hecho cuando: «Abrir en Talks» pasa directo (con el servidor de mentira), cae de vuelta al link normal si algo falla, y el resumen para Sergio dice en español llano qué cambió y qué le toca hacer (nada de variables nuevas; solo subir). Sin commit hasta que Sergio diga «sube». Si Talks necesita un cambio, repórtalo; no edites `~/estudio-sapience` desde aquí.

Nota para Sergio (no para el Hub): ya NO hay que agregar a cada persona nueva en `EQUIPO_PERMITIDO` de Render: quien entra desde el botón del Hub pasa directo, sin estar en esa lista. La lista solo manda para quien escribe la dirección de Talks y entra con su correo; ahí puede quedar muy poca gente.
