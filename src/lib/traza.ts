// Marcas de tiempo para medir de verdad cuánto tarda cada cosa entre pantallas. Solo se guardan si la página lo pide
// (window.__TRAZA = true, lo hace la prueba automática); en uso normal no hacen nada.
declare global { interface Window { __TRAZA?: boolean; __traza?: { t: number; e: string; d?: unknown }[]; __sala?: unknown } }

export function traza(evento: string, datos?: unknown): void {
  if (typeof window === 'undefined' || !window.__TRAZA) return;
  (window.__traza ??= []).push({ t: performance.timeOrigin + performance.now(), e: evento, d: datos });
}
