// Cómo se dibuja y cómo se pide la cámara de cada persona, sin recortarle la cara.
// Un celular en vertical manda un video más alto que ancho (por ejemplo 9:16) y casi todos los recuadros son horizontales (16:9):
// si se llena el recuadro, se pierde más de la mitad de la imagen. Estas reglas son puras (sin pantalla) para poder probarlas.
import type { AjusteDiseno } from '../../compartido/tipos';

export interface Medida { w: number; h: number }
export type AjusteImagen = 'cover' | 'contain';

/** Lo máximo que se acepta recortar de arriba y abajo al llenar el recuadro (0.35 = la tercera parte de la imagen). */
export const MAX_RECORTE_VERTICAL = 0.35;
/** Un video más angosto que esto (ancho / alto) se considera vertical. */
export const LIMITE_VERTICAL = 0.85;

const RATIO_MIN = 9 / 16;
const RATIO_MAX = 16 / 9;

/** Qué fracción de la altura de la imagen se perdería si se llena el recuadro (0 = nada). Solo cuenta lo de arriba y abajo: es donde está la cara. */
export function recorteVertical(video: Medida, celda: Medida): number {
  const rv = video.w / video.h;
  const rc = celda.w / celda.h;
  return rv < rc ? 1 - rv / rc : 0;
}

/**
 * Cómo ajustar el video dentro de su recuadro.
 * - «completo» (lo que eligió el equipo): siempre entero.
 * - Si todavía no se conoce la forma del video o del recuadro: se llena, como siempre.
 * - Si llenarlo cortaría demasiado de arriba y abajo (video vertical en un recuadro horizontal): se muestra entero.
 * - En lo demás se llena (un video horizontal en un recuadro más cuadrado solo pierde los lados, donde no hay cara).
 */
export function ajusteDeImagen(ajuste: AjusteDiseno, video: Medida | null, celda: Medida | null): AjusteImagen {
  if (ajuste === 'completo') return 'contain';
  if (!video || !celda || video.w <= 0 || video.h <= 0 || celda.w <= 0 || celda.h <= 0) return 'cover';
  return recorteVertical(video, celda) > MAX_RECORTE_VERTICAL ? 'contain' : 'cover';
}

export const esVertical = (video: Medida | null): boolean => !!video && video.h > 0 && video.w / video.h < LIMITE_VERTICAL;

/** Al llenar un video vertical, se apunta un poco hacia arriba (ahí está la cara en una selfie). */
export function posicionDeImagen(ajuste: AjusteImagen, video: Medida | null): string | undefined {
  return ajuste === 'cover' && esVertical(video) ? '50% 25%' : undefined;
}

/** Forma (ancho / alto) del recuadro propio: la del video de la persona, sin pasarse de vertical ni de horizontal. */
export function proporcionPropia(video: Medida | null): number {
  if (!video || video.w <= 0 || video.h <= 0) return RATIO_MAX;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, video.w / video.h));
}

export interface LimitesPropios { anchoMax: string; altoMax: string }

/**
 * Medidas del recuadro propio: tiene la forma del video y nunca pasa de `anchoMax` de ancho ni de `altoMax` de alto
 * (un celular vertical no debe ocupar toda la pantalla de arriba abajo).
 */
export function medidasPropias(video: Medida, limites: LimitesPropios): { aspectRatio: string; width: string } {
  const r = Number(proporcionPropia(video).toFixed(4));
  return { aspectRatio: String(r), width: `min(${limites.anchoMax}, calc(${limites.altoMax} * ${r}))` };
}

// ───────────────────────── Qué se le pide a la cámara ─────────────────────────

/**
 * Pedido de cámara para el navegador. En computadora se pide 640×360 (ligero y horizontal, que es como son las cámaras de laptop).
 * En celular NO se fuerza una forma: forzar horizontal hace que el navegador recorte la imagen vertical al tomarla
 * y la cara se pierde antes de enviarse; sin pedido, la cámara entrega su forma natural (en vertical, más alta que ancha).
 */
export function restriccionesDeVideo(camaraId: string | undefined, tactil: boolean, calidad: 'ligera' | 'alta' = 'ligera'): MediaTrackConstraints {
  const base: MediaTrackConstraints = camaraId ? { deviceId: { exact: camaraId } } : {};
  if (tactil) return base;
  // «alta» = lo mismo que pide LiveKit por defecto al transmitir al equipo (1280×720): así, si la vista previa se mantiene abierta, el navegador
  // reutiliza esa misma captura de la cámara en vez de reconfigurarla o arrancarla de cero al empezar a transmitir.
  return calidad === 'alta' ? { ...base, width: { ideal: 1280 }, height: { ideal: 720 } } : { ...base, width: { ideal: 640 }, height: { ideal: 360 } };
}

/** Lo mismo para la cámara que se publica en la sala (LiveKit pone 1280×720 si no se le dice nada, y eso también fuerza horizontal). */
export function opcionesDeCamara(camaraId: string | undefined, tactil: boolean): { deviceId: string | undefined; resolution: { width: number; height: number; frameRate: number } | undefined } {
  return { deviceId: camaraId, resolution: tactil ? undefined : { width: 640, height: 360, frameRate: 20 } };
}

/** ¿El aparato se maneja con el dedo (celular o tableta)? Una laptop con pantalla táctil cuenta como computadora: su puntero principal es el mouse. */
export function esTactil(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Con «?diag=1» en la dirección, cada recuadro muestra el tamaño real que llega de la cámara (para revisar celulares de verdad). */
export function hayDiagnostico(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diag') === '1';
}
