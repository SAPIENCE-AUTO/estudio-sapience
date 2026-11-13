// Dónde se guardan las sesiones para que un reinicio del servidor (en Render pasa con cada actualización) no las pierda.
//  - Postgres (Supabase): el de producción. Cada sesión es una fila con todo su estado en `talks.sesiones`.
//  - Archivo JSON: solo para desarrollo en la computadora, cuando no hay DATABASE_URL.
// Las dos formas cumplen el mismo contrato (`Almacen`): el resto del servidor no sabe cuál está usando.
import fs from 'node:fs';
import path from 'node:path';
import type { Sesion } from './dominio';

export interface Almacen {
  /** Todas las sesiones guardadas. Nadie está conectado todavía tras un reinicio: se vuelve a marcar cuando abran el canal en vivo. */
  cargar(): Promise<Record<string, Sesion>>;
  /** Pide guardar pronto (junta varios cambios seguidos en una sola escritura). Nunca lanza: un fallo se reporta y se reintenta en el siguiente cambio. */
  guardarPronto(sesiones: Record<string, Sesion>): void;
  /** Termina de guardar lo pendiente ahora mismo (al apagar el servidor y en las pruebas). */
  vaciar(): Promise<void>;
}

/** Lo mínimo que se necesita de una conexión a Postgres: sirve tanto para `pg` (producción) como para PGlite (pruebas). */
export interface Consultas {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function alCargar(todas: Record<string, Sesion>): Record<string, Sesion> {
  for (const s of Object.values(todas)) {
    for (const p of Object.values(s.participantes)) p.conectado = false;
    for (const m of Object.values(s.equipo)) m.conectado = false;
  }
  return todas;
}

// ───────────────────────── Postgres ─────────────────────────

/**
 * Las sesiones tienen nombres de personas y sus mensajes: la tabla va en un esquema propio (`talks`) que Supabase NO publica por su API,
 * con la seguridad por filas encendida y sin ningún permiso para los roles públicos. Solo el servidor (con su propia conexión) la lee.
 */
export const ESQUEMA_SQL = `
create schema if not exists talks;
create table if not exists talks.sesiones (
  id text primary key,
  datos jsonb not null,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
alter table talks.sesiones enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema talks from anon;
    revoke all on all tables in schema talks from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema talks from authenticated;
    revoke all on all tables in schema talks from authenticated;
  end if;
end $$;
`;

export function almacenPostgres(db: Consultas, opciones: { espera?: number; diasParaBorrarTerminadas?: number } = {}): Almacen {
  const espera = opciones.espera ?? 500;
  const dias = opciones.diasParaBorrarTerminadas ?? 60;
  /** Lo último que quedó guardado de cada sesión, para no reescribir lo que no cambió. */
  const guardado = new Map<string, string>();
  let temporizador: NodeJS.Timeout | null = null;
  let pendiente: Record<string, Sesion> | null = null;
  let escribiendo: Promise<void> = Promise.resolve();

  async function escribir(): Promise<void> {
    const sesiones = pendiente;
    pendiente = null;
    if (!sesiones) return;
    for (const [id, s] of Object.entries(sesiones)) {
      const texto = JSON.stringify(s);
      if (guardado.get(id) === texto) continue;
      try {
        await db.query(
          `insert into talks.sesiones (id, datos) values ($1, $2::jsonb)
           on conflict (id) do update set datos = excluded.datos, actualizada_en = now()`,
          [id, texto],
        );
        guardado.set(id, texto);
      } catch (e) {
        console.error(`No se pudo guardar la sesión ${id} (se reintenta en el siguiente cambio):`, (e as Error).message);
      }
    }
  }

  return {
    async cargar() {
      await db.query(ESQUEMA_SQL);
      await db.query(`delete from talks.sesiones where coalesce((datos->>'terminada')::boolean, false) and actualizada_en < now() - ($1 || ' days')::interval`, [String(dias)]);
      const { rows } = await db.query('select id, datos from talks.sesiones order by creada_en');
      const todas: Record<string, Sesion> = {};
      for (const fila of rows) {
        const s = (typeof fila.datos === 'string' ? JSON.parse(fila.datos) : fila.datos) as Sesion;
        todas[String(fila.id)] = s;
        guardado.set(String(fila.id), JSON.stringify(s));
      }
      return alCargar(todas);
    },
    guardarPronto(sesiones) {
      pendiente = sesiones;
      if (temporizador) return;
      temporizador = setTimeout(() => {
        temporizador = null;
        escribiendo = escribiendo.then(escribir);
      }, espera);
    },
    async vaciar() {
      if (temporizador) { clearTimeout(temporizador); temporizador = null; escribiendo = escribiendo.then(escribir); }
      await escribiendo;
    },
  };
}

// ───────────────────────── Archivo (solo desarrollo) ─────────────────────────

export function almacenArchivo(ruta = path.resolve('datos/sesiones.json')): Almacen {
  let temporizador: NodeJS.Timeout | null = null;
  let pendiente: Record<string, Sesion> | null = null;

  function escribir() {
    if (!pendiente) return;
    try {
      fs.mkdirSync(path.dirname(ruta), { recursive: true });
      const tmp = ruta + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(pendiente));
      fs.renameSync(tmp, ruta);
      pendiente = null;
    } catch (e) { console.error('No se pudo guardar el estado:', (e as Error).message); }
  }

  return {
    async cargar() {
      try { return alCargar(JSON.parse(fs.readFileSync(ruta, 'utf8')) as Record<string, Sesion>); } catch { return {}; }
    },
    guardarPronto(sesiones) {
      pendiente = sesiones;
      if (temporizador) return;
      temporizador = setTimeout(() => { temporizador = null; escribir(); }, 250);
    },
    async vaciar() {
      if (temporizador) { clearTimeout(temporizador); temporizador = null; }
      escribir();
    },
  };
}
