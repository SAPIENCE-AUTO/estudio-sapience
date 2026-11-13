import type { HighlightPublico } from '../../compartido/tipos';
import { duracion, fechaYHora } from './tiempo';

/** El minuto dentro de la grabación (00:27:05), o null si se marcó sin estar al aire (entonces solo hay hora). */
export function minutoDe(h: Pick<HighlightPublico, 'en' | 'vivoDesde'>): string | null {
  return h.vivoDesde === null ? null : duracion(h.en - h.vivoDesde);
}

/** Una celda de Excel que empieza con = + - @ se interpreta como fórmula: se le antepone una comilla para que sea solo texto. */
const celda = (valor: string): string => {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/** La lista de highlights como CSV que abre bien en Excel (con acentos): número, minuto de la grabación, hora, título y quién lo marcó. */
export function aCsv(highlights: HighlightPublico[]): string {
  const filas = [['Número', 'Minuto de la grabación', 'Hora', 'Título', 'Marcó'],
    ...highlights.map((h, i) => [String(i + 1), minutoDe(h) ?? '(sin EN VIVO)', fechaYHora(h.en), h.titulo, h.porNombre])];
  return '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

/** highlights-grupo-1.csv: el nombre de la sesión, limpio para usarse como nombre de archivo. */
export function nombreDeArchivo(sesion: string): string {
  const limpio = sesion.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `highlights-${limpio || 'sesion'}.csv`;
}
