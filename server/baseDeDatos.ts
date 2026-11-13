// Conexión a Postgres (la base de Talks en Supabase). Mismos cuidados que el Hub: sin límites de tiempo, una consulta atorada
// deja el servidor colgado en silencio.
import pg from 'pg';

export function crearPool(url: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: 4, // Talks guarda poco: pocas conexiones para no gastar las del plan
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  pool.on('error', (e) => console.error('[pg] error en una conexión inactiva:', e.message));
  return pool;
}

/**
 * La conexión DIRECTA de Supabase (db.xxxx.supabase.co) solo existe en IPv6: funciona desde casa y NO desde Render.
 * Devuelve el aviso si la dirección es de ese tipo, o null. Nunca incluye la dirección (trae la contraseña).
 */
export function avisoDeDireccion(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
      return 'Esta es la conexión DIRECTA de Supabase (solo IPv6): Render no la alcanza. Usa la de «Session pooler» (Connect, Session pooler, puerto 5432), cuyo servidor termina en pooler.supabase.com.';
    }
  } catch { return 'DATABASE_URL no es una dirección válida (revisa que no tenga espacios ni comillas).'; }
  return null;
}

/** Traduce los fallos de conexión más comunes a una frase que diga qué hacer. */
export function explicarFalloDeConexion(e: unknown, url: string): string {
  const codigo = (e as { code?: string }).code;
  const aviso = avisoDeDireccion(url);
  if (codigo === 'ENETUNREACH' || codigo === 'EHOSTUNREACH') return aviso ?? 'No hay ruta de red hacia la base de datos (en Render suele ser una dirección solo IPv6: usa la de Session pooler).';
  if (codigo === 'ENOTFOUND') return 'No se encontró el servidor de la base de datos: revisa la dirección de DATABASE_URL.';
  if (codigo === '28P01') return 'La contraseña de la base de datos no es correcta: revisa DATABASE_URL.';
  return (e as Error).message ?? String(e);
}
