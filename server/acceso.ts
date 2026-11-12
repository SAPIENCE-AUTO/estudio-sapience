// Reglas del acceso del equipo y firmas, SIN leer configuración ni red: así se prueban solas (pruebas/acceso.test.ts).
// server/auth.ts las conecta con la configuración real y con Supabase.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type CodigoAcceso = 'NO_AUTENTICADO' | 'SIN_ACCESO' | 'SIN_VERIFICAR';

/** 401: no hay sesión o venció. 403: hay sesión, pero ese correo no está autorizado. 503: no se pudo verificar (reintentar). */
export class ErrorAcceso extends Error {
  constructor(public estado: 401 | 403 | 503, public codigo: CodigoAcceso, mensaje: string) { super(mensaje); }
}

export interface UsuarioEquipo { email: string; nombre: string }

// ---- Firmas: el pase del participante y el boleto del equipo salen del mismo secreto, pero NO son intercambiables ----
export function crearFirmador(secreto: string, ahora: () => number = Date.now) {
  const firma = (cuerpo: string) => createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  return {
    firmar(tipo: string, datos: object, ttlMs: number): string {
      const cuerpo = Buffer.from(JSON.stringify({ ...datos, t: tipo, exp: ahora() + ttlMs })).toString('base64url');
      return `${cuerpo}.${firma(cuerpo)}`;
    },
    leer<T>(tipo: string, texto: string | null | undefined): T | null {
      if (!texto) return null;
      const [cuerpo, f, resto] = texto.split('.');
      if (!cuerpo || !f || resto !== undefined) return null;
      const esperada = Buffer.from(firma(cuerpo));
      const recibida = Buffer.from(f);
      if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
      try {
        const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as T & { t?: string; exp?: number };
        if (d.t !== tipo || typeof d.exp !== 'number' || d.exp < ahora()) return null;
        return d;
      } catch { return null; }
    },
  };
}

// ---- Lista de correos del equipo y nombre que se muestra ----
export function leerLista(texto: string): string[] {
  return [...new Set(texto.split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
}

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** El nombre de la cuenta si lo trae; si no, se arma con el correo («ana.lopez@…» queda «Ana Lopez»). */
export function nombreDeCorreo(email: string, meta?: Record<string, unknown> | null): string {
  for (const clave of ['full_name', 'name', 'nombre']) {
    const v = meta?.[clave];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
  }
  const local = email.split('@')[0] ?? email;
  return local.split(/[._-]+/).filter(Boolean).map(mayuscula).join(' ').slice(0, 60) || email;
}

// ---- Verificación de la sesión de Supabase ----
export interface UsuarioSupabase {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Devuelve quién es, o lanza ErrorAcceso. `obtenerUsuario` pregunta a Supabase por el token: null si es inválido o venció,
 * y lanza si Supabase no contestó. Se recuerda 60 s por token para no preguntar en cada llamada.
 */
export function crearVerificadorEquipo(o: {
  obtenerUsuario: (token: string) => Promise<UsuarioSupabase | null>;
  permitidos: string[];
  ahora?: () => number;
  ttlMs?: number;
}) {
  const ahora = o.ahora ?? Date.now;
  const ttl = o.ttlMs ?? 60_000;
  const permitidos = new Set(o.permitidos.map((c) => c.toLowerCase()));
  const memoria = new Map<string, { usuario: UsuarioEquipo; vence: number }>();

  return async function verificar(token: string | undefined | null): Promise<UsuarioEquipo> {
    if (!token) throw new ErrorAcceso(401, 'NO_AUTENTICADO', 'Entra con tu correo para continuar');
    const t = ahora();
    const guardado = memoria.get(token);
    if (guardado && guardado.vence > t) return guardado.usuario;

    let u: UsuarioSupabase | null;
    try { u = await o.obtenerUsuario(token); }
    catch { throw new ErrorAcceso(503, 'SIN_VERIFICAR', 'No pudimos verificar tu sesión. Intenta de nuevo en un momento'); }
    const email = u?.email?.trim().toLowerCase();
    if (!u || !email) throw new ErrorAcceso(401, 'NO_AUTENTICADO', 'Tu sesión venció. Entra de nuevo');
    if (!u.email_confirmed_at && !u.confirmed_at) throw new ErrorAcceso(401, 'NO_AUTENTICADO', 'Ese correo todavía no está confirmado');
    if (!permitidos.has(email)) throw new ErrorAcceso(403, 'SIN_ACCESO', 'Este correo no tiene acceso');

    const usuario: UsuarioEquipo = { email, nombre: nombreDeCorreo(email, u.user_metadata) };
    if (memoria.size >= 500) for (const [k, v] of memoria) if (v.vence <= t) memoria.delete(k);
    memoria.set(token, { usuario, vence: t + ttl });
    return usuario;
  };
}
