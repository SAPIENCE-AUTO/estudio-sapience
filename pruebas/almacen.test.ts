import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { almacenPostgres, type Consultas } from '../server/almacen';
import { entrar, llamar, mensajeDeParticipante, nuevaSesion, pasarASesion, unirseEquipo, type Sesion } from '../server/dominio';

/** Postgres de verdad (PGlite) en memoria: así se prueba el SQL real, no una imitación. Datos inventados. */
function baseDePrueba(): { pg: PGlite; db: Consultas; escrituras: () => number; fallarLaProxima: () => void } {
  const pg = new PGlite();
  let contador = 0;
  let fallar = false;
  const db: Consultas = {
    query: async (sql, params) => {
      if (/insert into talks\.sesiones/.test(sql)) {
        if (fallar) { fallar = false; throw new Error('se cayó la conexión'); }
        contador++;
      }
      if (params) return pg.query(sql, params as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>;
      const r = await pg.exec(sql);
      return (r[r.length - 1] ?? { rows: [] }) as { rows: Record<string, unknown>[] };
    },
  };
  return { pg, db, escrituras: () => contador, fallarLaProxima: () => { fallar = true; } };
}

function unaSesion(nombre = 'Prueba'): Sesion {
  const s = nuevaSesion(nombre);
  const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina');
  const ana = entrar(s, 'Ana');
  llamar(s, ana.id, eq.id); pasarASesion(s, ana.id);
  mensajeDeParticipante(s, ana.id, 'hola equipo');
  eq.conectado = true; s.participantes[ana.id]!.conectado = true;
  return s;
}

describe('guardar las sesiones en Postgres', () => {
  it('lo guardado sobrevive a un reinicio y nadie queda «conectado»', async () => {
    const { db } = baseDePrueba();
    const antes = almacenPostgres(db, { espera: 5 });
    await antes.cargar();
    const s = unaSesion();
    antes.guardarPronto({ [s.id]: s });
    await antes.vaciar();

    const despues = almacenPostgres(db, { espera: 5 }); // «reinicio»: un almacén nuevo sobre la misma base
    const cargadas = await despues.cargar();
    const leida = cargadas[s.id]!;
    expect(leida.nombre).toBe('Prueba');
    expect(leida.mensajes?.map((m) => m.texto)).toEqual(['hola equipo']);
    expect(Object.values(leida.participantes).every((p) => p.conectado === false)).toBe(true);
    expect(Object.values(leida.equipo).every((m) => m.conectado === false)).toBe(true);
    expect(Object.values(leida.participantes)[0]!.lugar).toBe('backstage'); // sigue donde estaba
  });

  it('no reescribe lo que no cambió y junta varios cambios seguidos en una sola escritura', async () => {
    const { db, escrituras } = baseDePrueba();
    const a = almacenPostgres(db, { espera: 5 });
    await a.cargar();
    const s = unaSesion(); const t = unaSesion('Otra');
    const todas = { [s.id]: s, [t.id]: t };
    a.guardarPronto(todas); a.guardarPronto(todas); a.guardarPronto(todas);
    await a.vaciar();
    expect(escrituras()).toBe(2); // una por sesión, no seis
    a.guardarPronto(todas); await a.vaciar();
    expect(escrituras()).toBe(2); // nada cambió: no se escribe
    s.nombre = 'Cambió';
    a.guardarPronto(todas); await a.vaciar();
    expect(escrituras()).toBe(3); // solo la que cambió
  });

  it('si se cae la conexión no se pierde nada: se reintenta en el siguiente guardado y el servidor sigue vivo', async () => {
    const { db, fallarLaProxima, escrituras } = baseDePrueba();
    const a = almacenPostgres(db, { espera: 5 });
    await a.cargar();
    const s = unaSesion();
    fallarLaProxima();
    a.guardarPronto({ [s.id]: s }); await a.vaciar();
    expect(escrituras()).toBe(0);
    a.guardarPronto({ [s.id]: s }); await a.vaciar();
    expect(escrituras()).toBe(1);
    const otro = almacenPostgres(db, { espera: 5 });
    expect(Object.keys(await otro.cargar())).toEqual([s.id]);
  });

  it('la tabla queda en un esquema propio con la seguridad por filas encendida (los datos no se publican por la API de Supabase)', async () => {
    const { db } = baseDePrueba();
    await almacenPostgres(db).cargar();
    const { rows } = await db.query(`select n.nspname as esquema, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'sesiones'`);
    expect(rows).toEqual([{ esquema: 'talks', rls: true }]);
    const publica = await db.query(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'sesiones' and n.nspname = 'public'`);
    expect(publica.rows.length).toBe(0);
  });

  it('cargar dos veces no rompe nada (el esquema ya existe)', async () => {
    const { db } = baseDePrueba();
    await almacenPostgres(db).cargar();
    await expect(almacenPostgres(db).cargar()).resolves.toEqual({});
  });

  it('las sesiones terminadas hace mucho se limpian; las recientes y las que siguen vivas no', async () => {
    const { db } = baseDePrueba();
    const a = almacenPostgres(db, { espera: 5, diasParaBorrarTerminadas: 60 });
    await a.cargar();
    const vieja = unaSesion('Vieja terminada'); vieja.terminada = true;
    const reciente = unaSesion('Reciente terminada'); reciente.terminada = true;
    const viva = unaSesion('Viva y antigua');
    a.guardarPronto({ [vieja.id]: vieja, [reciente.id]: reciente, [viva.id]: viva });
    await a.vaciar();
    await db.query(`update talks.sesiones set actualizada_en = now() - interval '90 days' where id = ANY($1::text[])`, [[vieja.id, viva.id]]);
    const nombres = Object.values(await almacenPostgres(db, { diasParaBorrarTerminadas: 60 }).cargar()).map((s) => s.nombre).sort();
    expect(nombres).toEqual(['Reciente terminada', 'Viva y antigua']);
  });
});
