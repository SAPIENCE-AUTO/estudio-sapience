// Reglas de la sesión, sin red ni LiveKit: quién puede estar dónde y cómo se mueve.
// Todo lo que cambia el estado sube la versión. Las acciones repetidas no cambian nada (así un doble clic no estorba).
import { randomBytes, createHash } from 'node:crypto';
import type { Lugar } from '../compartido/tipos';

export class ErrorDominio extends Error {
  constructor(public codigo: 'NO_ENCONTRADO' | 'NO_PERMITIDO' | 'SESION_TERMINADA', mensaje: string) {
    super(mensaje);
  }
}

export interface Participante {
  id: string;
  nombre: string;
  lugar: Lugar;
  verdeCon: string | null;
  conectado: boolean;
  entroEn: number;
  /** Cuándo aceptó el aviso de privacidad (entrar exige aceptarlo). Ausente en sesiones guardadas antes de que existiera. */
  avisoEn?: number;
  /** El equipo le quitó el micrófono (en LiveKit se le retira el permiso de publicar audio). */
  silenciado?: boolean;
}

export interface Miembro {
  id: string;
  nombre: string;
  email: string;
  enEscenario: boolean;
  conectado: boolean;
}

export interface Sesion {
  id: string;
  nombre: string;
  /** Código del link único de los participantes. */
  codigo: string;
  creadaEn: number;
  terminada: boolean;
  version: number;
  participantes: Record<string, Participante>;
  equipo: Record<string, Miembro>;
}

const aleatorio = (bytes: number) => randomBytes(bytes).toString('hex');

export function nuevaSesion(nombre: string, ahora = Date.now()): Sesion {
  return {
    id: 's' + aleatorio(5), nombre: nombre.trim().slice(0, 120) || 'Sesión sin nombre',
    codigo: aleatorio(6), creadaEn: ahora, terminada: false, version: 1, participantes: {}, equipo: {},
  };
}

function viva(s: Sesion) {
  if (s.terminada) throw new ErrorDominio('SESION_TERMINADA', 'La sesión ya terminó');
}
function participante(s: Sesion, id: string): Participante {
  const p = s.participantes[id];
  if (!p) throw new ErrorDominio('NO_ENCONTRADO', 'Esa persona no está en la sesión');
  return p;
}
function miembro(s: Sesion, id: string): Miembro {
  const m = s.equipo[id];
  if (!m) throw new ErrorDominio('NO_ENCONTRADO', 'Ese miembro del equipo no está en la sesión');
  return m;
}
const sube = (s: Sesion) => { s.version += 1; };

/** Un participante entra por el link único con el nombre que escribió. Cae en el lobby. */
export function entrar(s: Sesion, nombre: string, ahora = Date.now()): Participante {
  viva(s);
  const limpio = nombre.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!limpio) throw new ErrorDominio('NO_PERMITIDO', 'Escribe tu nombre');
  const p: Participante = { id: 'p_' + aleatorio(4), nombre: limpio, lugar: 'lobby', verdeCon: null, conectado: false, entroEn: ahora, avisoEn: ahora };
  s.participantes[p.id] = p;
  sube(s);
  return p;
}

/** El id de un miembro del equipo sale de su correo: es el mismo cada vez que entra, en cualquier pestaña. */
export function idMiembro(email: string): string {
  return 'eq_' + createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 8);
}

export function unirseEquipo(s: Sesion, email: string, nombre: string): Miembro {
  const id = idMiembro(email);
  const existente = s.equipo[id];
  if (existente) {
    if (nombre && existente.nombre !== nombre) { existente.nombre = nombre; sube(s); }
    return existente;
  }
  const m: Miembro = { id, nombre: nombre.trim().slice(0, 60) || 'Equipo', email: email.trim().toLowerCase(), enEscenario: false, conectado: false };
  s.equipo[id] = m;
  sube(s);
  return m;
}

/** Llamar a la sala verde: desde el lobby, o regresarlo desde backstage o escenario. */
export function llamar(s: Sesion, pid: string, equipoId: string): { cambio: boolean; de: Lugar } {
  viva(s); miembro(s, equipoId);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'verde' && p.verdeCon === equipoId) return { cambio: false, de };
  if (de === 'verde') throw new ErrorDominio('NO_PERMITIDO', 'Otra persona del equipo ya lo tiene en la sala verde');
  p.lugar = 'verde'; p.verdeCon = equipoId;
  sube(s);
  return { cambio: true, de };
}

/** De la sala verde a la sesión (queda en backstage, escuchando el escenario). */
export function pasarASesion(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'backstage' || de === 'escenario') return { cambio: false, de };
  if (de !== 'verde') throw new ErrorDominio('NO_PERMITIDO', 'Primero hay que llamarlo a la sala verde');
  p.lugar = 'backstage'; p.verdeCon = null;
  sube(s);
  return { cambio: true, de };
}

export function regresarALobby(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'lobby') return { cambio: false, de };
  p.lugar = 'lobby'; p.verdeCon = null;
  sube(s);
  return { cambio: true, de };
}

/** Quitar o permitir el micrófono de un participante. Permitirlo NO lo enciende: la persona decide cuándo hablar. */
export function silenciar(s: Sesion, pid: string, silenciado: boolean): { cambio: boolean } {
  viva(s);
  const p = participante(s, pid);
  if (!!p.silenciado === silenciado) return { cambio: false };
  p.silenciado = silenciado;
  sube(s);
  return { cambio: true };
}

export function subir(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'escenario') return { cambio: false, de };
  if (de !== 'backstage') throw new ErrorDominio('NO_PERMITIDO', 'Solo se sube a quien está en backstage');
  p.lugar = 'escenario';
  sube(s);
  return { cambio: true, de };
}

export function bajar(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'backstage') return { cambio: false, de };
  if (de !== 'escenario') throw new ErrorDominio('NO_PERMITIDO', 'Solo se baja a quien está en el escenario');
  p.lugar = 'backstage';
  sube(s);
  return { cambio: true, de };
}

export function ponerMiembroEnEscenario(s: Sesion, equipoId: string, enEscenario: boolean): boolean {
  const m = miembro(s, equipoId);
  if (m.enEscenario === enEscenario) return false;
  m.enEscenario = enEscenario;
  sube(s);
  return true;
}

/** Conexión o desconexión del canal en vivo. Es presencia: no mueve a nadie de lugar. */
export function marcarConexion(s: Sesion, quien: { participanteId?: string; equipoId?: string }, conectado: boolean): boolean {
  const o = quien.participanteId ? s.participantes[quien.participanteId] : quien.equipoId ? s.equipo[quien.equipoId] : undefined;
  if (!o || o.conectado === conectado) return false;
  o.conectado = conectado;
  sube(s);
  return true;
}

export function terminar(s: Sesion): boolean {
  if (s.terminada) return false;
  s.terminada = true;
  sube(s);
  return true;
}
