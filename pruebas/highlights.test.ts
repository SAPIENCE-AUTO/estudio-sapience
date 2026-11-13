import { describe, expect, it } from 'vitest';
import { ErrorDominio, borrarHighlight, entrar, iniciarEnVivo, llamar, marcarHighlight, nuevaSesion, pasarASesion, titularHighlight, unirseEquipo, type Sesion } from '../server/dominio';
import { estadoParaEquipo, estadoParaGrabadora, estadoParaParticipante } from '../server/vistas';
import { aCsv, minutoDe, nombreDeArchivo } from '../src/lib/highlights';
import { duracion } from '../src/lib/tiempo';
import type { HighlightPublico } from '../compartido/tipos';

function sesion(): { s: Sesion; eq: string; ana: string } {
  const s = nuevaSesion('Grupo 1', Date.now(), { externoId: 'evento-1', muxLlave: 'llave-de-prueba-1234' });
  const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
  const ana = entrar(s, 'Ana').id; llamar(s, ana, eq); pasarASesion(s, ana);
  return { s, eq, ana };
}

describe('highlights: reglas', () => {
  it('un clic marca el momento, con quién lo marcó y sin título', () => {
    const { s, eq } = sesion();
    const v = s.version;
    const h = marcarHighlight(s, eq, 1_000);
    expect(h).toMatchObject({ en: 1_000, titulo: '', porNombre: 'Marina', vivoDesde: null });
    expect(s.version).toBe(v + 1);
    expect(s.highlights).toHaveLength(1);
  });

  it('si se está al aire queda ligado a ESE EN VIVO, para contar desde que empezó la grabación', () => {
    const { s, eq } = sesion();
    iniciarEnVivo(s, 'EG_1', 10_000);
    const h = marcarHighlight(s, eq, 10_000 + 27 * 60_000 + 5_000);
    expect(h.vivoDesde).toBe(10_000);
    expect(minutoDe(h)).toBe('00:27:05');
  });

  it('cada highlight recuerda su propio EN VIVO aunque después se empiece otro', () => {
    const { s, eq } = sesion();
    iniciarEnVivo(s, 'EG_1', 0);
    const a = marcarHighlight(s, eq, 60_000);
    s.envivo = undefined;
    iniciarEnVivo(s, 'EG_2', 3_600_000);
    const b = marcarHighlight(s, eq, 3_600_000 + 120_000);
    expect([minutoDe(a), minutoDe(b)]).toEqual(['00:01:00', '00:02:00']);
  });

  it('ponerle título: se limpian los espacios, se recorta y no cuenta como cambio si es igual', () => {
    const { s, eq } = sesion();
    const h = marcarHighlight(s, eq);
    expect(titularHighlight(s, h.id, '  Rechazo   al empaque  ').cambio).toBe(true);
    expect(s.highlights![0]!.titulo).toBe('Rechazo al empaque');
    const v = s.version;
    expect(titularHighlight(s, h.id, 'Rechazo al empaque').cambio).toBe(false);
    expect(s.version).toBe(v);
    titularHighlight(s, h.id, 'x'.repeat(500));
    expect(s.highlights![0]!.titulo.length).toBe(120);
  });

  it('borrar quita solo ese; uno que ya no existe da error claro', () => {
    const { s, eq } = sesion();
    const a = marcarHighlight(s, eq); const b = marcarHighlight(s, eq);
    borrarHighlight(s, a.id);
    expect(s.highlights!.map((h) => h.id)).toEqual([b.id]);
    expect(() => borrarHighlight(s, a.id)).toThrow(ErrorDominio);
    expect(() => titularHighlight(s, 'h_inventado', 'x')).toThrow(ErrorDominio);
  });

  it('con la sesión terminada ya no se marcan nuevos, pero sí se pueden titular y borrar los que hay', () => {
    const { s, eq } = sesion();
    const h = marcarHighlight(s, eq);
    s.terminada = true;
    expect(() => marcarHighlight(s, eq)).toThrow(ErrorDominio);
    expect(titularHighlight(s, h.id, 'Se titula después').cambio).toBe(true);
    borrarHighlight(s, h.id);
    expect(s.highlights).toEqual([]);
  });

  it('solo se guardan los últimos 500', () => {
    const { s, eq } = sesion();
    for (let i = 0; i < 520; i++) marcarHighlight(s, eq, i);
    expect(s.highlights!.length).toBe(500);
    expect(s.highlights![0]!.en).toBe(20);
  });
});

describe('highlights: solo el equipo los ve', () => {
  it('no llegan a ningún participante, ni a la página que se transmite, ni con título', () => {
    const { s, eq, ana } = sesion();
    const h = marcarHighlight(s, eq);
    titularHighlight(s, h.id, 'cita sobre el precio');
    expect(estadoParaEquipo(s, eq).highlights.map((x) => x.titulo)).toEqual(['cita sobre el precio']);
    for (const texto of [JSON.stringify(estadoParaParticipante(s, ana)), JSON.stringify(estadoParaParticipante(s, entrar(s, 'Beto').id)), JSON.stringify(estadoParaGrabadora(s))]) {
      expect(texto).not.toContain('cita sobre el precio');
      expect(texto).not.toContain('highlights');
    }
  });
});

describe('highlights: exportar a CSV', () => {
  const h = (parche: Partial<HighlightPublico>): HighlightPublico => ({ id: 'h_1', en: 0, vivoDesde: null, titulo: '', porNombre: 'Marina', ...parche });

  it('trae encabezados, empieza con la marca que Excel necesita para los acentos y usa saltos de línea de Windows', () => {
    const csv = aCsv([h({ en: 27 * 60_000 + 5_000, vivoDesde: 0, titulo: 'Cita sobre el precio' })]);
    expect(csv.startsWith('﻿Número,Minuto de la grabación,Hora,Título,Marcó\r\n')).toBe(true);
    expect(csv).toContain('1,00:27:05,');
    expect(csv).toContain(',Cita sobre el precio,Marina\r\n');
  });

  it('lo marcado sin estar al aire lo dice, en lugar de inventar un minuto', () => {
    expect(aCsv([h({ en: 5_000 })])).toContain('(sin EN VIVO)');
    expect(minutoDe(h({}))).toBeNull();
  });

  it('comas, comillas y saltos de línea en el título no rompen el archivo', () => {
    const csv = aCsv([h({ titulo: 'Dijo "no me gusta", y se fue\nsin pagar' })]);
    expect(csv).toContain('"Dijo ""no me gusta"", y se fue\nsin pagar"');
  });

  it('un título que empieza con = + - @ no se convierte en fórmula de Excel', () => {
    for (const t of ['=SUMA(1,1)', '+cmd', '-2+3', '@usuario']) {
      const csv = aCsv([h({ titulo: t })]);
      expect(csv).not.toMatch(new RegExp(`,${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|\\r)`));
      expect(csv).toContain(`'${t}`);
    }
  });

  it('el nombre del archivo sale del nombre de la sesión, sin acentos ni símbolos', () => {
    expect(nombreDeArchivo('Grupo 1 – Aperol (México)')).toBe('highlights-grupo-1-aperol-mexico.csv');
    expect(nombreDeArchivo('###')).toBe('highlights-sesion.csv');
  });

  it('la duración se escribe con horas, minutos y segundos', () => {
    expect(duracion(0)).toBe('00:00:00');
    expect(duracion(3_725_000)).toBe('01:02:05');
    expect(duracion(-5)).toBe('00:00:00');
  });
});
