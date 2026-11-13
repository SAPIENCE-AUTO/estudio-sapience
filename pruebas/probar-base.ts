// Comprueba la conexión con la base de Supabase de Talks SIN guardar nada de verdad: crea el esquema, escribe una sesión de prueba,
// la lee y la borra. No imprime la dirección de conexión. Uso (la dirección va solo en tu terminal, nunca en un archivo ni en el chat):
//   DATABASE_URL='postgresql://...' npm run db:probar
import { almacenPostgres } from '../server/almacen';
import { avisoDeDireccion, crearPool, explicarFalloDeConexion } from '../server/baseDeDatos';
import { nuevaSesion } from '../server/dominio';

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('Falta DATABASE_URL. Corre:  DATABASE_URL=\'la-dirección-de-Supabase\' npm run db:probar');
  process.exit(1);
}

const paso = (texto: string) => console.log(`  ${texto}`);
const aviso = avisoDeDireccion(url);
if (aviso) console.log(`\n⚠ ${aviso}\n  (Desde tu computadora puede funcionar, pero en Render fallaría.)\n`);
const pool = crearPool(url);
try {
  console.log('Probando la base de Talks…');
  const { rows } = await pool.query('select current_database() as base, version() as version');
  paso(`Conecta: base «${String(rows[0]?.base)}», ${String(rows[0]?.version).split(' ').slice(0, 2).join(' ')}`);

  const almacen = almacenPostgres(pool, { espera: 10 });
  const antes = Object.keys(await almacen.cargar()).length;
  paso(`Crea el esquema «talks» y su tabla (sesiones guardadas hoy: ${antes})`);

  const prueba = nuevaSesion('Prueba de conexión (se borra sola)');
  prueba.id = 'prueba-conexion';
  almacen.guardarPronto({ [prueba.id]: prueba });
  await almacen.vaciar();
  const leida = await pool.query(`select datos->>'nombre' as nombre from talks.sesiones where id = $1`, [prueba.id]);
  if (leida.rows[0]?.nombre !== prueba.nombre) throw new Error('Se escribió, pero al leerla no coincide');
  paso('Escribe y lee una sesión de prueba');

  await pool.query(`delete from talks.sesiones where id = $1`, [prueba.id]);
  paso('Borra la sesión de prueba');

  const seguridad = await pool.query(`select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'talks' and c.relname = 'sesiones'`);
  if (seguridad.rows[0]?.rls !== true) throw new Error('La seguridad por filas NO está encendida en talks.sesiones');
  paso('La tabla tiene la seguridad por filas encendida (nadie entra por la API pública)');
  console.log('\nTodo bien: Talks puede guardar sus sesiones ahí.');
} catch (e) {
  console.error('\nFalló:', explicarFalloDeConexion(e, url));
  process.exitCode = 1;
} finally {
  await pool.end();
}
