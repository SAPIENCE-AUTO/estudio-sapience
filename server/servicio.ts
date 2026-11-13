// Orquesta cada acción: cambia las reglas (dominio), le pide a LiveKit lo que haga falta y avisa a todas las pantallas.
// Todo lo que cambia una sesión pasa por UNA fila (una acción a la vez por sesión): así las ráfagas de clics no se pisan.
// Cada acción trabaja sobre una copia y solo se confirma si LiveKit también respondió bien: nunca queda a medias.
import { salaSesion } from '../compartido/tipos';
import type { RespuestaAccion, RespuestaEntrar, RespuestaTokenEquipo } from '../compartido/tipos';
import * as d from './dominio';
import { guardarPronto, cargar } from './almacen';
import { difundir } from './difusion';
import { firmarPase } from './auth';
import * as lk from './livekit';

const sesiones: Record<string, d.Sesion> = cargar();
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
export function crearSesion(nombre: string): d.Sesion {
  const s = d.nuevaSesion(nombre);
  sesiones[s.id] = s;
  guardarPronto(sesiones);
  return s;
}

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
  await lk.permisos(salaSesion(s.id), pid, destino === 'lobby' ? { publicar: false, recibir: false } : { publicar: true, recibir: true, microfono: !s.participantes[pid]?.silenciado });
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
export function conexion(sid: string, quien: { participanteId?: string; equipoId?: string }, conectado: boolean): Promise<void> {
  if (!sesiones[sid]) return Promise.resolve();
  return transaccion(sid, async (s) => { d.marcarConexion(s, quien, conectado); });
}

export function terminar(sid: string): Promise<RespuestaAccion> {
  return transaccion(sid, async (s) => {
    d.terminar(s);
    await lk.borrarSala(salaSesion(sid));
    return respuesta(s);
  });
}
