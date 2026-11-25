// Quién puede recibir cada pista de una persona. Regla pura (sin LiveKit ni pantalla) para poder probarla sola: pruebas/permisos.test.ts.
// `proteger` (src/lib/sala.ts) la aplica a la sala de verdad.

/** A quién se le deja recibir: a todos, o solo a esas personas (por su identificador en LiveKit). */
export type Permitidos = 'todos' | string[];

/** Una pista publicada por la persona que protege: su identificador en LiveKit y si es de la pantalla compartida (video o sonido). */
export interface PistaPropia { sid: string; esPantalla: boolean }

/** Lo mismo que `ParticipantTrackPermission` de LiveKit. */
export interface PermisoPorPersona { participantIdentity: string; allowAll?: boolean; allowedTrackSids?: string[] }

export interface PermisosDePistas { todos: boolean; porPersona: PermisoPorPersona[] }

const incluye = (p: Permitidos, id: string): boolean => p === 'todos' || p.includes(id);

/** ¿Los dos grupos son el mismo? (entonces no hace falta separar las pistas de la pantalla de las demás). */
export function mismosPermitidos(a: Permitidos, b: Permitidos): boolean {
  if (a === 'todos' || b === 'todos') return a === b;
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Qué se le permite recibir a cada quien.
 * - `permitidos`: quién recibe cámara y micrófono. `pantalla`: quién recibe la pantalla compartida (video y sonido).
 * - Si son el mismo grupo se comporta como siempre (todos, o esas personas con todas sus pistas).
 * - Si son distintos, cada persona conocida recibe SOLO las pistas que le tocan: lo que no se lista queda bloqueado. Por eso quien
 *   protege debe volver a calcularlo cada vez que cambian sus pistas o llega alguien nuevo (si no, una pista nueva queda bloqueada para todos:
 *   falla del lado seguro).
 * - `conocidos`: quiénes están en la sala ahora (hace falta cuando un grupo es «todos» y el otro no, porque LiveKit no tiene «todos menos esta pista»).
 */
export function permisosDePistas(o: { permitidos: Permitidos; pantalla: Permitidos; conocidos: string[]; pistas: PistaPropia[] }): PermisosDePistas {
  const { permitidos, pantalla } = o;
  if (mismosPermitidos(permitidos, pantalla)) {
    if (permitidos === 'todos') return { todos: true, porPersona: [] };
    return { todos: false, porPersona: permitidos.map((id) => ({ participantIdentity: id, allowAll: true })) };
  }
  const sidsOtras = o.pistas.filter((p) => !p.esPantalla).map((p) => p.sid);
  const sidsPantalla = o.pistas.filter((p) => p.esPantalla).map((p) => p.sid);
  const personas = new Set<string>(o.conocidos);
  for (const lista of [permitidos, pantalla]) if (lista !== 'todos') for (const id of lista) personas.add(id);

  const porPersona: PermisoPorPersona[] = [];
  for (const id of personas) {
    const veOtras = incluye(permitidos, id);
    const vePantalla = incluye(pantalla, id);
    if (veOtras && vePantalla) porPersona.push({ participantIdentity: id, allowAll: true });
    else if (veOtras) porPersona.push({ participantIdentity: id, allowedTrackSids: sidsOtras });
    else if (vePantalla) porPersona.push({ participantIdentity: id, allowedTrackSids: sidsPantalla });
  }
  return { todos: false, porPersona };
}
