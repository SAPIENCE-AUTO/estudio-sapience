import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config';
import { crearRutas, manejarErrores } from './rutas';
import { leerBoleto, leerGrabadora, leerPase } from './auth';
import { idMiembro } from './dominio';
import * as servicio from './servicio';
import { clientes, conexionesDe, enviarEstado, quitar, registrar, type Cliente } from './difusion';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.get('/api/salud', (_req, res) => { res.json({ ok: true }); });
app.use('/api', crearRutas());

// En producción el mismo servidor entrega la interfaz compilada (un solo servicio, una sola dirección).
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => { res.sendFile(path.join(dist, 'index.html')); });
}
app.use(manejarErrores);

const servidor = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

interface Identidad { rol: 'equipo' | 'participante' | 'grabadora'; id: string; email?: string; nombre?: string }

servidor.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const sid = url.searchParams.get('sid') ?? '';
  const rol = url.searchParams.get('rol');
  const s = servicio.sesionPorId(sid);
  if (!s) { socket.destroy(); return; }
  let identidad: Identidad | null = null;
  if (rol === 'participante') {
    const p = leerPase(url.searchParams.get('pase'));
    if (p && p.sid === sid && s.participantes[p.pid]) identidad = { rol, id: p.pid };
  } else if (rol === 'equipo') {
    // El equipo abre el canal con un boleto de 60 s que pidió por HTTP (ahí sí se verificó su sesión).
    const b = leerBoleto(url.searchParams.get('boleto'));
    if (b && b.sid === sid) identidad = { rol, id: idMiembro(b.email), email: b.email, nombre: b.nombre };
  } else if (rol === 'grabadora') {
    // La página que se transmite entra con su boleto de 12 horas (lo arma el servidor al empezar el EN VIVO).
    const g = leerGrabadora(url.searchParams.get('t'));
    if (g && g.sid === sid) identidad = { rol, id: 'grabadora' };
  }
  if (!identidad) { socket.destroy(); return; }
  const quien = identidad;
  wss.handleUpgrade(req, socket, head, (ws) => { void alConectar(ws, sid, quien); });
});

const presencia = (i: Identidad) => (i.rol === 'equipo' ? { equipoId: i.id } : { participanteId: i.id });
/** La grabadora no es una persona: no cuenta como conectada ni aparece en ninguna lista. */
const esPersona = (i: Identidad) => i.rol !== 'grabadora';

async function alConectar(ws: WebSocket, sid: string, identidad: Identidad): Promise<void> {
  const c: Cliente = { ws, sid, rol: identidad.rol, id: identidad.id, vivo: true };
  try {
    if (identidad.rol === 'equipo') await servicio.unirseEquipo(sid, identidad.email!, identidad.nombre!);
    registrar(c);
    if (esPersona(identidad)) await servicio.conexion(sid, presencia(identidad), true); // difunde el estado a todos, también a esta pantalla
  } catch { ws.close(); return; }
  const s = servicio.sesionPorId(sid);
  if (s) enviarEstado(c, s);
  ws.on('pong', () => { c.vivo = true; });
  ws.on('message', (raw) => { if (String(raw) === 'ping') ws.send('pong'); });
  ws.on('close', () => {
    quitar(c);
    // Una pequeña espera: recargar la página no debe marcar a nadie como desconectado ni sacudir a las demás pantallas.
    if (esPersona(identidad)) setTimeout(() => { if (conexionesDe(sid, c.id) === 0) void servicio.conexion(sid, presencia(identidad), false); }, 4000);
  });
}

// Latido: una pantalla que no contesta en dos vueltas se cierra.
setInterval(() => {
  for (const c of clientes()) {
    if (!c.vivo) { c.ws.terminate(); continue; }
    c.vivo = false;
    try { c.ws.ping(); } catch { /* se cerrará solo */ }
  }
}, 15000);

await servicio.iniciar(); // carga las sesiones guardadas ANTES de aceptar a nadie

for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(senal, () => { void servicio.cerrar().catch((e) => console.error('No se pudo guardar al apagar:', e)).finally(() => process.exit(0)); });
}

servidor.listen(config.PORT, () => {
  console.log(`Talks: servidor en http://localhost:${config.PORT} (acceso del equipo: ${config.AUTH_MODE})`);
});
