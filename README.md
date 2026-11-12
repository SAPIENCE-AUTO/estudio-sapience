# Talks

Estudio de sesiones en vivo de Sapience (investigación de mercados): los participantes entran por un solo link, esperan en el **lobby**, el equipo los llama a una **sala verde** para revisar su conexión y los pasa a la sesión, donde hay **backstage** y **escenario**. Todo sobre LiveKit. Reemplaza el uso de StreamYard y se conectará al Hub de Sapience.

Vivirá en **talks.mx** (marca «Talks», aparte de Sharpli y de Sapience) como servicio propio en Render. La carpeta y el repositorio se llaman `estudio-sapience`; nada de lo que ve el participante lleva ese nombre (lo vigila `npm test`).

## Cómo correrlo

```bash
npm install
cp .env.example .env        # y llenar las llaves (ver abajo)
npm run dev                 # servidor en :8787 y pantalla en http://localhost:5173
```

- `/` crea una sesión (nombre) y muestra su link de participantes.
- `/equipo/<id de la sesión>` es la consola del equipo. En modo `dev` no hay login; se puede simular a otra persona del equipo con `?email=...&nombre=...`.
- `/p/<código>` es el link único de los participantes (el mismo para todos).

## Pruebas

```bash
npm test                    # reglas de la sesión (rápidas, sin red)
npm run e2e                 # de punta a punta: consola + 3 participantes reales en Chrome sin ventana
CAPTURAS=/tmp/capturas npm run e2e   # además guarda capturas de pantalla
TRAZA=1 npm run e2e         # además imprime la línea de tiempo entre pantallas
```

La prueba de punta a punta necesita el servidor y la pantalla encendidos (`npm run dev`) y Google Chrome instalado. Mide cuánto tarda cada cambio y revisa que nadie reciba de más (también a nivel de red, no solo lo que se dibuja).

## Variables de entorno

Ver `.env.example`. Las de LiveKit son obligatorias. En producción: cuenta propia de LiveKit, `AUTH_MODE=supabase` (pendiente de conectar) y `HUB_API_KEY` para que el Hub cree sesiones.

## Estado

Primera rebanada funcionando: lobby, sala verde, backstage, escenario, consola del equipo, subir y bajar. Falta: login real del equipo, base de datos propia, chats, highlights, programa para observadores (Mux), grabación, fondos y banners, transmisión a YouTube, conexión con el Hub y pruebas en celulares reales. El contexto completo y las decisiones están en `CLAUDE.md`.
