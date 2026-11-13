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
