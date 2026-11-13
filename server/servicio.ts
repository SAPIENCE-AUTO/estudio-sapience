// Orquesta cada acción: cambia las reglas (dominio), le pide a LiveKit lo que haga falta y avisa a todas las pantallas.
// Todo lo que cambia una sesión pasa por UNA fila (una acción a la vez por sesión): así las ráfagas de clics no se pisan.
// Cada acción trabaja sobre una copia y solo se confirma si LiveKit también respondió bien: nunca queda a medias.
import { salaSesion } from '../compartido/tipos';
import type { RespuestaAccion, RespuestaEntrar, RespuestaTokenEquipo, CanalChat, ConfigChat, Diseno } from '../compartido/tipos';
import * as d from './dominio';
import { almacenArchivo, almacenPostgres, type Almacen } from './almacen';
import { avisoDeDireccion, crearPool, explicarFalloDeConexion } from './baseDeDatos';
import { difundir } from './difusion';
import { firmarPase } from './auth';
import * as lk from './livekit';
import { config } from './config';

const sesiones: Record<string, d.Sesion> = {};
let almacen: Almacen = almacenArchivo();
const guardarPronto = (s: Record<string, d.Sesion>) => almacen.guardarPronto(s);
const filas = new Map<string, Promise<unknown>>();

function enFila<T>(sid: string, accion: () => Promise<T>): Promise<T> {
  const anterior = filas.get(sid) ?? Promise.resolve();
  const siguiente = anterior.catch(() => undefined).then(accion);
  filas.set(sid, siguiente.catch(() => undefined));
  return siguiente;
}

const obtener = (sid: string): d.Sesion => {
  const s = sesiones[sid];
  if (!s) throw new d.ErrorDominio('NO_ENCONTRADO', 'Esa sesión no existe');
  return s;
};

/** Trabaja sobre una copia; si todo sale bien se confirma y se avisa a las pantallas. */
async function transaccion<T>(sid: string, trabajo: (copia: d.Sesion) => Promise<T>): Promise<T> {
  return enFila(sid, async () => {
    const copia = structuredClone(obtener(sid));
    const resultado = await trabajo(copia);
    sesiones[sid] = copia;
    guardarPronto(sesiones);
    difundir(copia);
    return resultado;
  });
}

// ---------- consultas ----------
export function listarSesiones(): d.Sesion[] {
  return Object.values(sesiones).sort((a, b) => b.creadaEn - a.creadaEn);
}
export const sesionPorId = (sid: string) => sesiones[sid];
export function sesionPorCodigo(codigo: string): d.Sesion | undefined {
  return Object.values(sesiones).find((s) => s.codigo === codigo);
}

// ---------- crear ----------
/** Crea la sesión (o, si viene el evento del Hub y ya existe, la devuelve). */
export function crearSesion(nombre: string, externos: d.DatosExternos = {}): { sesion: d.Sesion; yaExistia: boolean } {
  const r = d.crearOActualizar(sesiones, nombre, externos);
  if (r.cambio) { guardarPronto(sesiones); if (r.yaExistia) difundir(r.sesion); }
  return { sesion: r.sesion, yaExistia: r.yaExistia };
}
export const sesionDelEvento = (externoId: string) => d.sesionDelEvento(sesiones, externoId);

// ---------- participantes ----------
export async function entrarParticipante(codigo: string, nombre: string): Promise<RespuestaEntrar> {
  const existente = sesionPorCodigo(codigo);
  if (!existente) throw new d.ErrorDominio('NO_ENCONTRADO', 'Ese link no es válido');
  return transaccion(existente.id, async (s) => {
    const p = d.entrar(s, nombre);
    return { sesionId: s.id, participanteId: p.id, pase: firmarPase({ sid: s.id, pid: p.id }), livekit: await livekitDe(s, p) };
  });
}

/** Pase de LiveKit con los permisos que corresponden al lugar donde está la persona ahora (sirve al entrar y al volver a conectarse tras recargar). */
async function livekitDe(s: d.Sesion, p: d.Participante): Promise<RespuestaEntrar['livekit']> {
  const sala = salaSesion(s.id);
  await lk.asegurarSala(sala);
  const activo = p.lugar !== 'lobby';
  return { url: lk.urlLivekit, sala, token: await lk.tokenParticipante(sala, p.id, { publicar: activo, recibir: activo, microfono: !p.silenciado }) };
}

export async function livekitDeParticipante(sid: string, pid: string): Promise<RespuestaEntrar['livekit']> {
  const s = obtener(sid);
  const p = s.participantes[pid];
  if (!p) throw new d.ErrorDominio('NO_ENCONTRADO', 'Esa persona no está en la sesión');
  if (s.terminada) throw new d.ErrorDominio('SESION_TERMINADA', 'La sesión ya terminó');
  return livekitDe(s, p);
}

type Cambio = { cambio: boolean; de: import('../compartido/tipos').Lugar };

/** Nadie cambia de sala: solo se enciende o se apaga lo que la persona puede publicar y recibir (el lobby no publica ni recibe). */
async function permisosPorLugar(s: d.Sesion, pid: string, destino: 'lobby' | 'activo'): Promise<void> {
  try {
    await lk.permisos(salaSesion(s.id), pid, destino === 'lobby' ? { publicar: false, recibir: false } : { publicar: true, recibir: true, microfono: !s.participantes[pid]?.silenciado });
  } catch (e) {
    // Si la persona se desconectó, LiveKit ya no la encuentra: el cambio de lugar SÍ vale (si no, no se podría mover a nadie desconectado).
    // Cuando vuelva a entrar, su pase nuevo ya trae los permisos del lugar donde quedó.
    if (!(e instanceof lk.PersonaDesconectada)) throw e;
  }
}

const respuesta = (s: d.Sesion): RespuestaAccion => ({ v: s.version });

export function llamar(sid: string, pid: string, equipoId: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    const r: Cambio = d.llamar(s, pid, equipoId);
    if (r.cambio && r.de === 'lobby') await permisosPorLugar(s, pid, 'activo');
    return respuesta(s);
  });
}

export function pasarASesion(sid: string, pid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    d.pasarASesion(s, pid); // ya publica y recibe desde la sala verde: solo cambia el lugar
    return respuesta(s);
  });
}

export function regresarALobby(sid: string, pid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    const r: Cambio = d.regresarALobby(s, pid);
    if (r.cambio) await permisosPorLugar(s, pid, 'lobby');
    return respuesta(s);
  });
}

/** Chats. No tocan LiveKit: son estado de la sesión, igual que todo lo demás, y llegan con la versión. */
export function mensajeDelEquipo(sid: string, equipoId: string, canal: CanalChat, texto: string, para: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.mensajeDelEquipo(s, equipoId, canal, texto, para); return respuesta(s); });
}
export function mensajeDeParticipante(sid: string, pid: string, texto: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.mensajeDeParticipante(s, pid, texto); return respuesta(s); });
}

export function ponerChat(sid: string, cfg: ConfigChat): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.ponerChat(s, cfg); return respuesta(s); });
}

/** El equipo elige el diseño del escenario. No toca LiveKit: solo cambia cómo se dibuja (en pantalla, y más adelante en la grabación). */
export function ponerDiseno(sid: string, diseno: Diseno): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.ponerDiseno(s, diseno); return respuesta(s); });
}

/** El equipo quita o permite el micrófono de un participante. Si no está conectado, queda guardado y vale al volver a entrar. */
export function silenciar(sid: string, pid: string, silenciado: boolean): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    const r = d.silenciar(s, pid, silenciado);
    const p = s.participantes[pid]!;
    if (r.cambio && p.lugar !== 'lobby') {
      try { await lk.permisos(salaSesion(s.id), pid, { publicar: true, recibir: true, microfono: !silenciado }); }
      catch (e) { if (!(e instanceof lk.PersonaDesconectada)) throw e; }
    }
    return respuesta(s);
  });
}

// Subir y bajar no tocan LiveKit: la persona sigue en la misma sala y cambia quién puede recibir sus pistas (lo hace su pantalla).
export function subir(sid: string, pid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.subir(s, pid); return respuesta(s); });
}
export function bajar(sid: string, pid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.bajar(s, pid); return respuesta(s); });
}

// ---------- equipo ----------
export function unirseEquipo(sid: string, email: string, nombre: string): Promise<d.Miembro> {
  return transaccion(sid, async (s) => d.unirseEquipo(s, email, nombre));
}

export function ponerEnEscenario(sid: string, equipoId: string, enEscenario: boolean): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => { d.ponerMiembroEnEscenario(s, equipoId, enEscenario); return respuesta(s); });
}

export async function tokenParaEquipo(sid: string, equipoId: string): Promise<RespuestaTokenEquipo> {
  const s = obtener(sid);
  const m = s.equipo[equipoId];
  if (!m) throw new d.ErrorDominio('NO_PERMITIDO', 'Primero hay que unirse a la sesión');
  const sala = salaSesion(sid);
  await lk.asegurarSala(sala);
  return { url: lk.urlLivekit, token: await lk.tokenEquipo(sala, equipoId, m.nombre), sala };
}

// ---------- presencia (canal en vivo abierto o cerrado) ----------
// ---------- desconexiones ----------
// Quien se desconecta sigue en su lugar (viñeta apagada, «Sin conexión») durante un rato: las redes flojas se reconectan solas y no hay
// que volver a subirlo. Si no regresa, el servidor lo manda al lobby; ahí no se ve mientras siga sin conexión y reaparece si vuelve.
const gracia = new Map<string, NodeJS.Timeout>();

function vigilarAusencia(sid: string, pid: string): void {
  const clave = `${sid}:${pid}`;
  clearTimeout(gracia.get(clave));
  gracia.set(clave, setTimeout(() => {
    gracia.delete(clave);
    void regresarPorAusencia(sid, pid).catch(() => undefined);
  }, config.GRACIA_DESCONEXION_SEGUNDOS * 1000));
}

async function regresarPorAusencia(sid: string, pid: string): Promise<void> {
  if (!sesiones[sid]) return;
  await transaccion(sid, async (s) => {
    const p = s.participantes[pid];
    if (!p || p.conectado || p.lugar === 'lobby' || s.terminada) return;
    d.regresarALobby(s, pid);
    await permisosPorLugar(s, pid, 'lobby');
  });
}

export function conexion(sid: string, quien: { participanteId?: string; equipoId?: string }, conectado: boolean): Promise<void> {
  if (!sesiones[sid]) return Promise.resolve();
  const pid = quien.participanteId;
  if (pid) { if (conectado) { clearTimeout(gracia.get(`${sid}:${pid}`)); gracia.delete(`${sid}:${pid}`); } else vigilarAusencia(sid, pid); }
  return transaccion(sid, async (s) => { d.marcarConexion(s, quien, conectado); });
}

/**
 * Arranque: elige dónde se guardan las sesiones (Postgres si hay DATABASE_URL, si no un archivo local), las carga y reanuda los plazos.
 * Tras reiniciar el servidor nadie está conectado todavía: quien estaba adentro tiene el mismo plazo para volver.
 */
export async function iniciar(elegido?: Almacen): Promise<void> {
  almacen = elegido ?? (config.DATABASE_URL ? almacenPostgres(crearPool(config.DATABASE_URL)) : almacenArchivo());
  if (config.DATABASE_URL && !elegido) { const aviso = avisoDeDireccion(config.DATABASE_URL); if (aviso) console.warn(`AVISO: ${aviso}`); }
  // Si la base no contesta se reintenta unos segundos y, si sigue sin contestar, el servidor NO arranca (así Render conserva la versión que ya funcionaba).
  for (let intento = 1; ; intento++) {
    try { Object.assign(sesiones, await almacen.cargar()); break; }
    catch (e) {
      const motivo = config.DATABASE_URL && !elegido ? explicarFalloDeConexion(e, config.DATABASE_URL) : (e as Error).message;
      if (intento >= 4) { console.error(`No se pudo abrir la base de datos de Talks: ${motivo}`); process.exit(1); }
      console.warn(`La base de datos no contestó (intento ${intento} de 4): ${motivo}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  for (const s of Object.values(sesiones)) {
    if (s.terminada) continue;
    for (const p of Object.values(s.participantes)) if (p.lugar !== 'lobby' && !p.conectado) vigilarAusencia(s.id, p.id);
  }
  console.log(`Talks: ${Object.keys(sesiones).length} sesiones cargadas (${config.DATABASE_URL && !elegido ? 'Postgres' : 'archivo local'})`);
}

/** Al apagar el servidor (Render manda una señal en cada actualización): termina de guardar lo pendiente. */
export async function cerrar(): Promise<void> {
  for (const t of gracia.values()) clearTimeout(t);
  await almacen.vaciar();
}

export function terminar(sid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    d.terminar(s);
    await lk.borrarSala(salaSesion(sid));
    return respuesta(s);
  });
}
