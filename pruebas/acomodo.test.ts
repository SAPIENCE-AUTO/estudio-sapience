import { describe, expect, it } from 'vitest';
import { acomodo, columnasPara } from '../src/lib/acomodo';

describe('acomodo del escenario', () => {
  it('sin gente no hay filas', () => {
    expect(acomodo(0)).toEqual([]);
    expect(acomodo(-3)).toEqual([]);
    expect(acomodo(Number.NaN)).toEqual([]);
  });

  it('una persona ocupa todo y dos van lado a lado', () => {
    expect(acomodo(1)).toEqual([1]);
    expect(acomodo(2)).toEqual([2]);
  });

  it('de tres en adelante forma una cuadrícula con la última fila más corta', () => {
    expect(acomodo(3)).toEqual([2, 1]);
    expect(acomodo(4)).toEqual([2, 2]);
    expect(acomodo(5)).toEqual([3, 2]);
    expect(acomodo(6)).toEqual([3, 3]);
  });

  it('reparte parejo: nunca deja una fila de una sola persona debajo de filas largas', () => {
    expect(acomodo(7)).toEqual([3, 2, 2]);
    expect(acomodo(8)).toEqual([3, 3, 2]);
    expect(acomodo(10)).toEqual([4, 3, 3]);
  });

  it('para cualquier cantidad: suma exacta, ninguna fila supera las columnas y las filas no crecen hacia abajo', () => {
    for (let n = 1; n <= 40; n++) {
      const filas = acomodo(n);
      expect(filas.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...filas)).toBeLessThanOrEqual(columnasPara(n));
      for (let i = 1; i < filas.length; i++) expect(filas[i]).toBeLessThanOrEqual(filas[i - 1]!);
      expect(filas[0]! - filas[filas.length - 1]!).toBeLessThanOrEqual(1);
    }
  });
});
