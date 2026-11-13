# Talks (carpeta estudio-sapience): contexto para trabajar en el código

App aparte (no vive en el Hub) para correr sesiones de investigación en vivo con participantes externos. Sapience es una agencia de investigación de mercados en México; quien dirige el proyecto es Sergio. Se conectará al Hub (`~/hub-sapience`) por API. **Todo texto para Sergio va en español, sin jerga y sin «·».**

## Qué hace

Un link único para todos los participantes (entran con el nombre que escriben, sin asignar a nadie). Flujo: **lobby** (prueban cámara y micrófono, esperan) → el equipo los **llama a la sala verde** (1 a 1, privado) → los pasa a la **sesión**: **backstage** (oyen y ven solo el escenario y a sí mismos) o **escenario** (se ven y se oyen entre todos). El equipo ve a todos y puede subir, bajar y regresar a quien sea a la sala verde o al lobby.

## Dónde nos quedamos (2026-11-12)

Esta carpeta se desarrolla en su PROPIA sesión de Claude, con su propia memoria (`~/.claude/projects/-Users-sergiovelasco-estudio-sapience/memory/`: ahí está el expediente completo de decisiones, pruebas y costos). Sergio lo pidió así para no mezclarla con la del Hub («para no perder la esencia del Hub»): Talks no se edita desde una sesión del Hub.

**Hecho:**
- Primera rebanada completa (lobby, sala verde, backstage, escenario, consola del equipo), probada de punta a punta con Chrome sin ventana (24 de 24 antes del login) y con pruebas de reglas.
- Nombre «Talks» y dominio `talks.mx`, con la regla de marca neutra vigilada por una prueba.
- Preparado para Render: `npm start` sin `.env`, `tsx` en dependencias, compilación de producción probada.
- **Login real del equipo, ESCRITO pero sin ensayo de punta a punta.** `server/acceso.ts` (reglas puras: firmas, lista de correos, verificación con memoria de 60 s; 14 pruebas en `pruebas/acceso.test.ts`) y `server/auth.ts` (pregunta a Supabase con `GET /auth/v1/user`, igual que el Hub). Rutas nuevas: `/api/config-publica`, `/api/equipo/yo` y `/api/sesiones/:sid/equipo/boleto`. El equipo abre el canal en vivo con un **boleto** firmado de 60 s (el navegador no manda encabezados en un WebSocket; así la sesión de Supabase nunca viaja en la dirección) y pide uno nuevo en cada reconexión. Pantallas: `src/pages/Entrar.tsx` (correo y enlace mágico con `shouldCreateUser: false`) y la guardia `src/components/ProtegidoEquipo.tsx`, que una vez adentro NUNCA vuelve a tapar la pantalla (Supabase repite `SIGNED_IN` al volver a la pestaña). Supabase se carga con `import()` solo en las pantallas del equipo, los participantes no lo descargan. Variables nuevas: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EQUIPO_PERMITIDO`. En modo `dev` todo sigue como antes (sin login).

**Hecho el 2026-11-12 (sesión nueva):**
- `npm run e2e`: 24 de 24, con los tiempos de «Números medidos» (el boleto del canal en vivo funciona).
- Ensayo del login: `npm run ensayo-login` (`pruebas/ensayo-login.ts`, 26 de 26). Levanta un Supabase de mentira y un servidor en modo `supabase` con la compilación de producción, y prueba en Chrome: correo desconocido, cuenta sin permiso («Este correo no tiene acceso»), entrar con el enlace, canal en vivo con boleto (sin token en la dirección), volver a la pestaña, recargar, sesión vencida, salir, y que los participantes no descarguen ni hablen con Supabase. Nunca manda correos. Hay que correr `npm run build` antes.
- `render.yaml` del servicio `talks` escrito (plan `starter`, región `virginia`, llaves con `sync: false`, `APP_SECRET` generado). Sin probar en Render (Claude no tiene acceso).

**Fase 1 del rediseño (2026-11-12, SIN subir; boceto aprobado, ver memoria `project_talks_diseno_consola`):** escenario de lienzo 16:9 con acomodo automático (`src/lib/acomodo.ts` + `src/components/Lienzo.tsx`, 5 pruebas en `pruebas/acomodo.test.ts`); consola con escenario grande, controles de micrófono y cámara del moderador, backstage siempre visible y «Ir a backstage / Volver al escenario» (su viñeta queda opaca con vista previa local), indicadores rojo con campana (lobby) y azul oscuro con puerta (sala verde) con ícono y texto; participante con aviso de privacidad antes del nombre (`src/lib/aviso.ts`, TEXTO PROVISIONAL: el servidor exige `aceptoAviso: true` y guarda `avisoEn`). e2e 25 de 25. **Falta de la fase 1:** selector de diseños (foco, lado a lado, viñetas redondas, fijar), vistas Moderación/Producción, los tres chats, highlights, indicador EN VIVO/Grabando, aviso de «conexión lenta» y solo audio, grabación.

**Ajustes tras probar en local (2026-11-12, SIN subir):** (1) la viñeta propia en backstage salía gris: una pista propia SILENCIADA (la cámara se apaga al salir del escenario) seguía existiendo y daba cuadros negros; ahora solo se dibuja si no está silenciada (la prueba de e2e lo revisa con `readyState === 'live'`: revisar solo `videoWidth` NO lo detectaba). (2) Subir, bajar e ir a backstage ahora son un clic en la viñeta (`ClicParaMover`, mismos `data-testid` `subir-`/`bajar-`/`ir-backstage`/`volver-escenario`). (3) El equipo puede silenciar a un participante (`silenciado` en el estado del servidor; se le quita el permiso de publicar audio en LiveKit; permitirlo NO lo enciende, decide la persona). e2e 32 de 32.

**Controles propios (2026-11-12, SIN subir):** cada participante controla cámara y micrófono en TODO momento: antes, cada cambio de lugar (sala verde, escenario) se los volvía a encender (`quiere` en `Participante.tsx` guarda su decisión; lo prueba el e2e en backstage, sala verde y escenario). Botones de micrófono y cámara grandes con texto: azul oscuro (teal) encendidos, rojo sólido apagados, con ícono tachado. e2e 39 de 39.

**Selector de diseños (2026-11-12, SIN subir):** el diseño del escenario (`auto`, `foco`, `lado`, `redondas` + quién va grande) es estado del SERVIDOR (`Sesion.diseno`, `POST /sesiones/:sid/diseno`) y llega en el estado de la consola Y del participante, así todas las pantallas lo dibujan igual (y más adelante la grabación). `Lienzo` recibe `diseno` y las viñetas con id; `ordenar()` en `src/lib/acomodo.ts` pone primero al fijado. Botón «Diseño» en la consola con miniaturas. e2e 47 de 47 (revisa que todas las pantallas ven el mismo diseño y los tamaños).

**Diseños combinables y desconexión (2026-11-12, SIN subir):** (1) `Diseno` ahora tiene 4 ajustes que se combinan: acomodo (`auto`, `foco`, `tira-abajo`, `lado`, `fila`, `redondas`), forma (`cuadrada`, `redondeada`, `circulo`, también el moderador), ajuste de la imagen (`llenar` recorta, `completo` no recorta: `AjusteContext` llega a `Mosaico`) y fondo (`gris`, `blanco`, `negro`, `marca`); `normalizarDiseno()` completa sesiones guardadas antes. En círculo el tamaño sale de la celda con unidades de contenedor (`cqw/cqh`). La ventana «Diseño» es un panel fijo a la derecha para que el escenario quede a la vista. (2) Error: si alguien se desconectaba en backstage y se le mandaba al lobby, LiveKit contestaba «no la encuentro» y TODO el cambio se cancelaba (volvía a backstage); `permisosPorLugar` ahora tolera `PersonaDesconectada` (el cambio de lugar vale; los permisos los trae su pase al volver). Las viñetas de desconectados se ven apagadas con «Sin conexión». e2e 59 de 59 (la prueba de desconexión se confirmó fallando sin el arreglo).

**Desconexiones y backstage opaco (2026-11-12, SIN subir):** quien se desconecta sigue en su lugar con la viñeta apagada y «Sin conexión» durante `GRACIA_DESCONEXION_SEGUNDOS` (30 por defecto; las redes flojas se reconectan solas); si no vuelve, el servidor lo regresa al lobby (`regresarPorAusencia` en `servicio.ts`, también tras reiniciar el servidor) y en el lobby NO se muestra mientras siga sin conexión (reaparece si vuelve). Todas las viñetas de backstage llevan un velo claro (`Velo`). Los cambios de diseño muy seguidos ya no se pisan (`elegirDiseno` parte de lo último pedido). e2e 65 de 65.

**Subido el 2026-11-12:** primer commit `37e7fe2` a `git@github.com:SAPIENCE-AUTO/estudio-sapience.git` (rama `main`). Los siguientes commits también solo cuando Sergio diga «sube». Sin datos reales en el commit. Nota: `npm run build` revisa tipos también de `pruebas/`; un error ahí rompe la compilación de Render.

**Pasos que hace Sergio** (Claude no tiene acceso a Render ni a GoDaddy): (1) crear el repositorio privado vacío `SAPIENCE-AUTO/estudio-sapience`; (2) crear un proyecto propio en LiveKit Cloud y pegar las llaves directo en Render, Claude no las ve; (3) en Render, New → Blueprint con ese repositorio; (4) cuando `talks.mx` ya se publique en internet (al 2026-11-12 aún no tenía servidores de nombres), agregarlo como dominio del servicio y crear los registros en GoDaddy (apex con A 216.24.57.1 como `sharpli.mx`, `www` con CNAME); (5) registrar `https://talks.mx` en las URL de redirección del Supabase del Hub y copiar `SUPABASE_URL` y `SUPABASE_ANON_KEY` del servicio del Hub; (6) poner en `EQUIPO_PERMITIDO` los correos del equipo.

**Antes de la primera sesión real:** el dominio nació el 2026-11-12, así que mandar invitaciones de prueba a Gmail, Outlook y un correo de empresa para ver que no caigan en spam ni las bloquee un firewall; y probar en celulares (iPhone/Safari y Android) y en una red con firewall estricto.

## Cómo trabajar con Sergio

- **Español llano, sin jerga**, siempre (resúmenes y cierres también; nada de mezclar inglés). Abrir con qué pasa y por qué, en palabras de uso diario; el detalle técnico después o en el commit. Si hay que decidir: una recomendación y una pregunta de sí o no, no un menú de opciones.
- **Nunca «·»** (punto medio): usar «:», «,» o «–».
- **Pedidos chicos = versión simple:** lo mínimo que cumpla, medir lo justo y volver con «¿commit y push?». Si algo va a tardar, decírselo antes. Si pregunta «¿cómo hacemos X?», responder primero con recomendación y criterio, sin abrir herramientas.
- **Estimaciones ancladas en lo real:** quién paga (una PYME) y lo que de verdad tomó; un solo número con rango y 2 o 3 supuestos; días de programador separados de días con todo incluido.
- **Antes de decir que algo no existe**, buscarlo en el historial (`git log -S`). Si dice que algo funcionaba, suponer que tiene razón.
- **Commits solo cuando él lo pide** («sube»), con mensaje en español «Área: qué cambió» y la línea `Co-Authored-By`. **Sin datos reales** (correos, teléfonos, nombres de personas o clientes, montos): datos inventados con `@ejemplo.test`. El clasificador de Claude Code ya negó pushes por «Data Exfiltration»; nunca ofuscar datos para esquivarlo.
- **Hay una persona daltónica en el equipo:** nunca solo rojo y verde para distinguir estados (agregar texto, ícono o forma) y medir cada color nuevo contra TODA la gráfica antes de decir que es seguro.
- **Cuidar el cupo del plan:** antes de lanzar varios agentes o trabajo muy largo, revisar el uso (`get_usage`) y avisarle el costo; el 2026-11-11 el límite semanal llegó al 100% con el uso extra activado. En sesiones muy largas, proponer cerrar con un resumen y seguir en otra.

## Dónde vive y cómo se llama

- **Marca para participantes: «Talks», dominio `talks.mx`** (Sergio lo registró el 2026-11-12 en GoDaddy, hasta 2029; marca aparte de Sharpli y de Sapience). Va como servicio propio en Render, no dentro del Hub (un push al Hub reinicia su API y cortaría sesiones en vivo); el Hub se conecta por API. La dirección vive en una sola variable (`URL_PUBLICA`).
- **Regla de marca neutra, igual que en sharpli.mx: nada que descargue el navegador dice «Sapience»**: `index.html`, `src/`, `compartido/` y `dist/`. Lo vigila `pruebas/marca.test.ts` (corre con `npm test` y revisa `dist/` si hay compilación). El nombre de la carpeta y del repositorio sí puede llevarlo.
- **Producción en Render:** `npm start` no lee `.env` (las variables van en el panel de Render); `tsx` está en `dependencies` porque el servidor corre TypeScript directo; el mismo servidor entrega la interfaz compilada de `dist/`. `AUTH_MODE=dev` se niega a arrancar con `NODE_ENV=production`.

## Decisiones que NO se deben deshacer sin medir

1. **UNA sala de LiveKit por sesión** (`sesion.<id>`). Lobby, verde, backstage y escenario son estados dentro de esa sala. **No usar `moveParticipant` ni salas por persona**: se probó y algunas personas movidas quedaban con la recepción lenta (1 a 4 s para ver a quien subía al escenario, con una distribución impredecible). Con una sola sala todos reciben igual de rápido (audio ≈ 0.14 s, video ≈ 0.28 s, sin atípicos).
2. **Cada persona protege SUS pistas** con `localParticipant.setTrackSubscriptionPermissions(false, [identidades permitidas])`, siempre ANTES de publicar y cada vez que cambia el lugar o el equipo (`src/lib/sala.ts`, `permitidosDeParticipante`): escenario = todos; sala verde = solo quien llamó; backstage = solo el equipo. Es una barrera real del servidor de LiveKit (se comprueba a nivel de red en la prueba de punta a punta: en backstage nadie recibe NADA de nadie). Un grabador (permiso `recorder`, como el egress) sí recibe pistas protegidas.
3. **El lobby no publica ni recibe**: el pase del participante nace con `canPublish: false, canSubscribe: false`; el servidor da permisos con `updateParticipant` al llamarlo (`server/servicio.ts`).
4. **Identidades al azar** (`p_xxxxxxxx`, `eq_xxxxxxxx`) y sin nombre en LiveKit: todos los de la sala ven la lista de identidades aunque no reciban video. Los nombres que escribe la gente viven solo en el servidor; cada quien recibe una vista distinta del estado (`server/vistas.ts`): el participante NUNCA recibe la lista completa.
5. **El estado vive en el servidor, con versión** (`Sesion.version` solo sube). Todo cambio entra por una fila por sesión (`servicio.ts`, `enFila`), se hace sobre una copia y solo se confirma si LiveKit también respondió. Las pantallas reciben su vista por WebSocket (`/ws`) y **solo aceptan versiones mayores a la ya vista** (`src/lib/canal.ts`): nada viejo ni repetido hace parpadear la pantalla. Las acciones repetidas no cambian nada (un doble clic no estorba).
6. **La pantalla se dibuja SOLO del estado del servidor**, nunca de los eventos de suscripción de LiveKit (en ráfagas hay vaivén de eventos). Los videos se refrescan con `useCambiosDeSala`; mientras llega el primer cuadro el mosaico muestra una silueta con el nombre (nunca negro).
7. **Consola optimista** (`src/lib/useConsola.ts`): al hacer clic el mosaico se mueve al instante (parche) y el parche se retira cuando llega la versión que lo confirma o si el servidor lo rechaza.

## Números medidos (Chrome sin ventana, buena red, una región)

Aviso del cambio a todas las pantallas ≈ 4 ms · pantalla cambia al hacer clic ≈ 18 ms · audio de quien sube les llega a los demás ≈ 140 ms · video ≈ 275 ms · al bajar deja de llegarles de verdad en ≈ 350 ms · llamar a la sala verde: su pantalla cambia en ≈ 75 ms. En celulares con 4G esperar más en el medio (0.5 a 1 s), no en el aviso de estado.

## Cómo se prueba (importante)

- **Encender:** `preview_start` con la configuración `talks` (`.claude/launch.json`) o `npm run dev` en una pestaña de Terminal; la pantalla queda en `http://localhost:5173` y el servidor en `:8787` (al editar `server/` se reinicia solo). En modo `dev` no hay login. Los equipos simulados se piden con `?email=…&nombre=…` en la dirección de la consola.
- `npm test`: reglas de la sesión (`server/dominio.ts`, incluida una ráfaga de 5,000 acciones al azar), acceso del equipo (`pruebas/acceso.test.ts`) y marca neutra (`pruebas/marca.test.ts`).
- `npm run e2e`: `pruebas/e2e.ts` abre un Chrome distinto por cada actor (consola y 3 participantes) para que ninguna pantalla quede oculta y frenada, mide, revisa privacidad a nivel de red (`window.__sala`) y hace una ráfaga de 40 cambios.
- **El Chrome sin ventana de este entorno NO logra abrir cámara ni micrófono** (`getUserMedia` se cuelga, incluso con los dispositivos de mentira): la prueba inyecta una cámara y un tono sintéticos. La apertura de la cámara real se revisa a mano en computadoras y celulares de verdad.
- **No medir tiempos en el panel del navegador de Claude**: oculto frena los relojes a 1 por segundo. Comprobar siempre `document.visibilityState` y calibrar `setTimeout(100)`; tomar las marcas con `performance.now()` dentro de los eventos y medir con varias rondas y percentiles, no con un caso.
- `src/lib/traza.ts`: marcas de tiempo entre pantallas (solo si `window.__TRAZA`); `TRAZA=1 npm run e2e` imprime la línea de tiempo.
- Para funciones pasadas a `page.evaluate` con `tsx`: no declarar funciones con nombre dentro (esbuild agrega `__name` y truena en la página); pasar el código como texto.

## Estructura

```
compartido/tipos.ts     tipos que viajan por la red (estado de cada vista, respuestas)
server/dominio.ts       reglas puras: quién puede estar dónde (sin red ni LiveKit)
server/servicio.ts      orquesta: reglas + LiveKit + aviso a las pantallas (una fila por sesión, copia y confirma)
server/livekit.ts       pases, permisos, salas
server/vistas.ts        lo que ve cada quien   |  server/difusion.ts  WebSocket por sesión
server/acceso.ts        reglas puras del acceso: firmas, lista de correos, verificación (sin red ni configuración)
server/auth.ts          las conecta con la configuración y con Supabase: pase, boleto y acceso del equipo
server/almacen.ts       guardado provisional en datos/sesiones.json (pendiente: Postgres)
server/rutas.ts         API HTTP (zod)         |  server/index.ts     arranque
src/pages/              Participante, Consola, Inicio, Entrar   |  src/lib/  canal, sala, useConsola, medios, api, acceso, traza
src/components/         Mosaico, Video, ProtegidoEquipo
pruebas/                dominio.test.ts, acceso.test.ts, marca.test.ts, e2e.ts
```

Convenciones: nombres en español siguiendo el módulo; un solo lugar para los tipos compartidos; sin Redux ni Zustand; look claro, Poppins, teal del Hub (`#0F3D4D`), dorado SOLO para «Tú» y highlights; texto mínimo en pantalla; sin números sobre el escenario; el equipo ve «Backstage» y «Escenario», el participante ve «En espera» y «En pantalla».

## Pendiente (en orden aproximado)

1. Login real del equipo (Supabase Auth del Hub, mismo proyecto, lista de correos permitidos): ESCRITO, falta el ensayo de punta a punta (ver «Dónde nos quedamos») y comprobarlo con el Supabase real después del despliegue. Hoy `AUTH_MODE=dev` en local (el servidor se niega a arrancar así en producción).
2. Base de datos propia (Postgres) en lugar del JSON; bitácora de asistencia con el nombre escrito.
3. Chat de la sesión y chat del equipo con observadores (los participantes no lo ven), highlights, levantar la mano, silenciar y expulsar.
4. Programa para observadores: plantilla web del escenario (fondos, banners, supers, pantalla compartida, estímulos) → egress de LiveKit → RTMPS a la llave de Mux de la sala de observación del Hub (`/s/:slug`, ya existe en el Hub); grabación total y por participante (track egress); transmitir fuera (YouTube, otros).
5. API para el Hub: `POST /api/v1/sesiones` ya existe (llave `HUB_API_KEY`); falta devolver/recibir asistencia, grabaciones y highlights, y programar desde el Hub.
6. Prueba de conexión (`ConnectionCheck` de livekit-client) en el lobby; reconexión y «señal débil»; iPhone/Safari (cámara abierta dos veces, sonido con gesto) y red de un cliente con firewall estricto.
7. Despliegue en `talks.mx` (lo crea Sergio; Claude no tiene acceso a Render): `render.yaml` con el servicio `talks`, repositorio privado en GitHub, proyecto propio de LiveKit, URL de redirección en el Supabase del Hub, DNS (apex con A 216.24.57.1 como sharpli.mx), invitaciones de prueba a Gmail, Outlook y un correo de empresa (dominio nuevo, sin reputación) y revisión de seguridad antes de sesiones reales.
8. Pulido: la cuadrícula del escenario con 3 mosaicos deja una celda vacía; fundido de video; textos.
