// Acceso directo desde el Hub: quien ya entró al Hub aprieta «Abrir en Talks» y pasa sin volver a pedir su correo.
// Reglas puras (sin configuración ni red) para probarlas solas: pruebas/accesohub.test.ts. server/auth.ts las conecta.
//
// Cómo funciona: el Hub, que ya sabe quién es la persona, le pide a Talks (con la llave que ya comparten) un PASE DE UN SOLO USO
// para ese correo. Vale 60 segundos y se gasta al usarse. Talks lo cambia por una sesión del equipo (12 horas, firmada).
// Nunca se copia la sesión del Hub a Talks: solo viaja un pase que no sirve para nada más.
import { randomBytes } from 'node:crypto';

/** El pase vale un minuto: lo justo para que el navegador abra la dirección. */
export const TTL_PASE_HUB_MS = 60_000;
/** La sesión que Talks da a cambio dura lo que una sesión larga de investigación. */
export const TTL_SESION_EQUIPO_MS = 12 * 3600 * 1000;

export interface DatosPaseHub { email: string; nombre: string; destino: string }

/** Id de una sesión de Talks: letras, números, guion y guion bajo. Se valida porque termina dentro de una dirección. */
export const ID_SESION = /^[A-Za-z0-9_-]{1,64}$/;

/** A dónde lleva el pase: a la consola de una sesión, o al inicio del equipo si no se dice cuál. Nunca una dirección de afuera. */
export function destinoDeSesion(sesionId?: string | null): string {
  if (!sesionId) return '/';
  if (!ID_SESION.test(sesionId)) throw new Error('Id de sesión inválido');
  return `/equipo/${sesionId}`;
}

/** Guarda los pases pendientes EN MEMORIA: se gastan al usarse (aunque estén vencidos) y un reinicio los borra, que es lo correcto para algo que vale un minuto. */
export function crearBuzonDePases(o: { ahora?: () => number; ttlMs?: number; maximo?: number; generar?: () => string } = {}) {
  const ahora = o.ahora ?? Date.now;
  const ttl = o.ttlMs ?? TTL_PASE_HUB_MS;
  const maximo = o.maximo ?? 200;
  const generar = o.generar ?? (() => randomBytes(32).toString('base64url')); // 256 bits: no se adivina
  const pendientes = new Map<string, DatosPaseHub & { vence: number }>();

  return {
    /** Crea un pase nuevo para esa persona y lo devuelve (es lo que va en la dirección). */
    emitir(d: DatosPaseHub): string {
      const t = ahora();
      if (pendientes.size >= maximo) {
        for (const [k, v] of pendientes) if (v.vence <= t) pendientes.delete(k);
        // Si todavía está lleno, se descartan los más viejos (el Map conserva el orden en que se crearon).
        for (const k of pendientes.keys()) { if (pendientes.size < maximo) break; pendientes.delete(k); }
      }
      const codigo = generar();
      pendientes.set(codigo, { ...d, vence: t + ttl });
      return codigo;
    },
    /** Cambia el pase por los datos de la persona. Solo sirve UNA vez y solo antes de que venza; si no, null. */
    canjear(codigo: unknown): DatosPaseHub | null {
      if (typeof codigo !== 'string' || codigo.length < 8 || codigo.length > 200) return null;
      const d = pendientes.get(codigo);
      if (!d) return null;
      pendientes.delete(codigo); // se gasta siempre, esté vencido o no
      if (d.vence < ahora()) return null;
      return { email: d.email, nombre: d.nombre, destino: d.destino };
    },
    cuantos: () => pendientes.size,
  };
}
