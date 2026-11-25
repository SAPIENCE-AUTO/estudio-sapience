import { ID_PANTALLA, type Diseno, type TipoDiseno } from '../../compartido/tipos';

// Cómo se acomoda la gente dentro del escenario. El lienzo siempre es 16:9; lo que cambia es lo de adentro:
// 1 persona ocupa todo, 2 van lado a lado, de 3 en adelante forman una cuadrícula y la última fila se centra.

/** Columnas máximas según cuánta gente hay. */
export function columnasPara(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/**
 * Cuántas personas van en cada fila (de arriba hacia abajo). Se reparten parejo: con 7 salen 3, 2 y 2, no 3, 3 y 1.
 * Devuelve una lista vacía si no hay nadie.
 */
export function acomodo(n: number): number[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  const cantidad = Math.floor(n);
  const filas = Math.ceil(cantidad / columnasPara(cantidad));
  const base = Math.floor(cantidad / filas);
  const sobran = cantidad % filas;
  return Array.from({ length: filas }, (_, i) => base + (i < sobran ? 1 : 0));
}

/**
 * Con una pantalla compartida en el escenario, la pantalla va grande y las personas en una tira abajo; la forma, el ajuste y el fondo que eligió el equipo se respetan.
 * Es el mismo cálculo en todas las pantallas (consola, participantes y transmisión), así todos ven lo mismo. Si la pantalla va sola, ocupa todo.
 */
export function disenoConPantalla(diseno: Diseno, hayPantalla: boolean): Diseno {
  return hayPantalla ? { ...diseno, tipo: 'tira-abajo', fijado: ID_PANTALLA } : diseno;
}

/** Los acomodos donde una persona va grande y las demás van aparte. */
export const tieneFoco = (tipo: TipoDiseno) => tipo === 'foco' || tipo === 'tira-abajo' || tipo === 'redondas';

/**
 * Orden de las personas según el diseño. En «foco» y «redondas» la primera va grande: la que el equipo fijó
 * si está en el escenario, y si no, la primera de la lista. En los demás diseños el orden no cambia.
 */
export function ordenar<T extends { id: string }>(personas: T[], diseno: Diseno): T[] {
  if (!tieneFoco(diseno.tipo)) return personas;
  const i = personas.findIndex((p) => p.id === diseno.fijado);
  if (i <= 0) return personas;
  return [personas[i]!, ...personas.slice(0, i), ...personas.slice(i + 1)];
}
