import type { RespuestaAccion, RespuestaEntrar, RespuestaTokenEquipo } from '../../compartido/tipos';
import { tokenDeEquipo } from './acceso';

export class ErrorApi extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) { super(mensaje); }
}

/** Solo en modo dev: el correo y el nombre del equipo pueden venir en la dirección (?email=...&nombre=...) para simular a varias personas. */
export function identidadEquipo(): { email?: string; nombre?: string } {
  const q = new URLSearchParams(location.search);
  return { email: q.get('email') ?? undefined, nombre: q.get('nombre') ?? undefined };
}

async function pedir<T>(ruta: string, o: { cuerpo?: unknown; pase?: string; equipo?: boolean; metodo?: string } = {}): Promise<T> {
  // Con login real (producción) el equipo manda su sesión; sin login (modo dev) puede simular a otra persona por la dirección.
  const token = o.equipo ? await tokenDeEquipo() : null;
  const eq = o.equipo && !token ? identidadEquipo() : {};
  const r = await fetch('/api' + ruta, {
    method: o.metodo ?? (o.cuerpo !== undefined || o.pase || o.equipo ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : o.pase ? { authorization: `Bearer ${o.pase}` } : {}),
      ...(eq.email ? { 'x-equipo-email': eq.email } : {}),
      ...(eq.nombre ? { 'x-equipo-nombre': encodeURIComponent(eq.nombre) } : {}),
    },
    body: o.cuerpo !== undefined ? JSON.stringify(o.cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(r.status, datos.error ?? 'ERROR', datos.mensaje ?? 'Algo salió mal');
  return datos as T;
}

export interface ResumenSesion {
  id: string; nombre: string; codigo: string; terminada: boolean; creadaEn: number;
  linkParticipantes: string; linkEquipo: string; participantes: number;
}

export const api = {
  // equipo
  sesiones: () => pedir<ResumenSesion[]>('/sesiones', { equipo: true, metodo: 'GET' }),
  crearSesion: (nombre: string) => pedir<ResumenSesion>('/v1/sesiones', { equipo: true, cuerpo: { nombre } }),
  accion: (sid: string, pid: string, accion: 'llamar' | 'pasar' | 'lobby' | 'subir' | 'bajar') =>
    pedir<RespuestaAccion>(`/sesiones/${sid}/participantes/${pid}/${accion}`, { equipo: true }),
  yo: () => pedir<{ email: string; nombre: string }>('/equipo/yo', { equipo: true, metodo: 'GET' }),
  boletoEquipo: (sid: string) => pedir<{ boleto: string }>(`/sesiones/${sid}/equipo/boleto`, { equipo: true }),
  tokenEquipo: (sid: string) => pedir<RespuestaTokenEquipo>(`/sesiones/${sid}/equipo/token`, { equipo: true }),
  miembroEnEscenario: (sid: string, enEscenario: boolean) =>
    pedir<RespuestaAccion>(`/sesiones/${sid}/equipo/escenario`, { equipo: true, cuerpo: { enEscenario } }),
  terminar: (sid: string) => pedir<RespuestaAccion>(`/sesiones/${sid}/terminar`, { equipo: true }),
  // participante
  infoLink: (codigo: string) => pedir<{ nombre: string }>(`/p/${codigo}`),
  entrar: (codigo: string, nombre: string) => pedir<RespuestaEntrar>(`/p/${codigo}/entrar`, { cuerpo: { nombre } }),
  livekitActual: (pase: string) => pedir<RespuestaEntrar['livekit']>('/yo/livekit', { pase }),
};
