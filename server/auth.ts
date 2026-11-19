import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config';
import { crearFirmador, crearVerificadorEquipo, ErrorAcceso, leerLista, type UsuarioEquipo, type UsuarioSupabase } from './acceso';
import { crearBuzonDePases, TTL_SESION_EQUIPO_MS } from './accesoHub';

export { ErrorAcceso, type UsuarioEquipo };

const sellos = crearFirmador(config.APP_SECRET);

// ---- Pase del participante: firmado con APP_SECRET, vale 12 horas ----
export interface DatosPase { sid: string; pid: string }

export const firmarPase = (datos: DatosPase, ttlMs = 12 * 3600 * 1000): string =>
  sellos.firmar('pase', { sid: datos.sid, pid: datos.pid }, ttlMs);

export function leerPase(pase: string | undefined | null): DatosPase | null {
  const d = sellos.leer<DatosPase>('pase', pase);
  return d?.sid && d.pid ? { sid: d.sid, pid: d.pid } : null;
}

export function pasePorEncabezado(req: IncomingMessage): DatosPase | null {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? leerPase(h.slice(7)) : null;
}

// ---- Boleto del equipo para el canal en vivo: vale 60 segundos y solo sirve para una sesión ----
// (el navegador no puede mandar encabezados en un WebSocket; así la sesión de Supabase nunca viaja en la dirección)
export interface DatosBoleto { sid: string; email: string; nombre: string }

export const firmarBoleto = (d: DatosBoleto): string => sellos.firmar('boleto', { sid: d.sid, email: d.email, nombre: d.nombre }, 60_000);

export function leerBoleto(boleto: string | undefined | null): DatosBoleto | null {
  const d = sellos.leer<DatosBoleto>('boleto', boleto);
  return d?.sid && d.email && d.nombre ? { sid: d.sid, email: d.email, nombre: d.nombre } : null;
}

// ---- Boleto de la grabadora: la página que se transmite (la abre LiveKit, no una persona). Vale 12 horas y solo sirve para una sesión ----
export const firmarGrabadora = (sid: string): string => sellos.firmar('grabadora', { sid }, 12 * 3600 * 1000);
export function leerGrabadora(boleto: string | undefined | null): { sid: string } | null {
  const d = sellos.leer<{ sid: string }>('grabadora', boleto);
  return d?.sid ? { sid: d.sid } : null;
}

// ---- Acceso del equipo ----
/** Pregunta a Supabase quién es el dueño del token (el mismo camino que usa el Hub). null = inválido o vencido; lanza si no contestó. */
async function usuarioDeSupabase(token: string): Promise<UsuarioSupabase | null> {
  const r = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: config.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}`);
  return (await r.json()) as UsuarioSupabase;
}

// EQUIPO_PERMITIDO manda solo para quien entra DIRECTO con su correo (enlace de Supabase). Quien llega desde el Hub entra con la sesión de abajo:
// ahí responde el Hub, que solo deja entrar a las personas dadas de alta en su tabla de usuarios, así que no hay que mantener una segunda lista.
const permitidosDelEquipo = new Set(leerLista(config.EQUIPO_PERMITIDO));

const verificarSupabase = config.AUTH_MODE === 'supabase'
  ? crearVerificadorEquipo({ obtenerUsuario: usuarioDeSupabase, permitidos: [...permitidosDelEquipo] })
  : null;

// ---- Acceso directo desde el Hub: pase de un solo uso (60 s) que se cambia por una sesión del equipo firmada (12 h) ----
// Ver server/accesoHub.ts. La sesión firmada NO se parece a un token de Supabase ni a un pase de participante (tipo distinto).
export const buzonDePasesHub = crearBuzonDePases();

export const firmarSesionEquipo = (u: UsuarioEquipo): string => sellos.firmar('equipo', { email: u.email, nombre: u.nombre }, TTL_SESION_EQUIPO_MS);

export function leerSesionEquipo(token: string | undefined | null): UsuarioEquipo | null {
  const d = sellos.leer<UsuarioEquipo>('equipo', token);
  return d?.email && d.nombre ? { email: d.email, nombre: d.nombre } : null;
}

/**
 * Quién es del equipo. En modo dev no hay login: se acepta el usuario de prueba, o el que mande la prueba automática
 * en los encabezados x-equipo-email / x-equipo-nombre (para simular a varias personas del equipo). En modo supabase
 * hace falta la sesión real del Hub (Bearer) y que el correo esté en EQUIPO_PERMITIDO. Si no hay acceso lanza ErrorAcceso.
 */
export async function equipoDesdeSolicitud(req: IncomingMessage): Promise<UsuarioEquipo> {
  if (verificarSupabase) {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    // Primero la sesión que dio el acceso directo desde el Hub (firmada por Talks, se comprueba aquí mismo, sin red y sin lista);
    // si no es de ese tipo, es de Supabase y ahí sí manda EQUIPO_PERMITIDO.
    const delHub = leerSesionEquipo(token);
    if (delHub) return delHub;
    return verificarSupabase(token);
  }
  const correo = (req.headers['x-equipo-email'] as string | undefined) ?? config.DEV_EQUIPO_EMAIL;
  const nombre = (req.headers['x-equipo-nombre'] as string | undefined) ?? config.DEV_EQUIPO_NOMBRE;
  return { email: correo, nombre: decodeURIComponent(nombre) };
}

export function esLlaveDelHub(req: IncomingMessage): boolean {
  if (!config.HUB_API_KEY) return false;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return false;
  const a = Buffer.from(h.slice(7));
  const b = Buffer.from(config.HUB_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}
