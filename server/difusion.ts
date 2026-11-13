// Canal en vivo (WebSocket) con cada pantalla abierta. Cada quien recibe SU vista del estado, con número de versión.
import type { WebSocket } from 'ws';
import type { Sesion } from './dominio';
import { estadoParaEquipo, estadoParaGrabadora, estadoParaParticipante } from './vistas';

export interface Cliente {
  ws: WebSocket;
  sid: string;
  rol: 'equipo' | 'participante' | 'grabadora';
  /** Id del miembro del equipo o del participante. */
  id: string;
  vivo: boolean;
}

const porSesion = new Map<string, Set<Cliente>>();

export function registrar(c: Cliente): void {
  if (!porSesion.has(c.sid)) porSesion.set(c.sid, new Set());
  porSesion.get(c.sid)!.add(c);
}

export function quitar(c: Cliente): void {
  porSesion.get(c.sid)?.delete(c);
}

export function conexionesDe(sid: string, id: string): number {
  let n = 0;
  for (const c of porSesion.get(sid) ?? []) if (c.id === id) n++;
  return n;
}

function vistaPara(c: Cliente, s: Sesion): string | null {
  const estado = c.rol === 'equipo' ? estadoParaEquipo(s, c.id) : c.rol === 'grabadora' ? estadoParaGrabadora(s) : estadoParaParticipante(s, c.id);
  return estado ? JSON.stringify(estado) : null;
}

export function enviarEstado(c: Cliente, s: Sesion): void {
  const msg = vistaPara(c, s);
  if (msg && c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
}

export function difundir(s: Sesion): void {
  for (const c of porSesion.get(s.id) ?? []) enviarEstado(c, s);
}

export function clientes(): Cliente[] {
  return [...porSesion.values()].flatMap((set) => [...set]);
}
