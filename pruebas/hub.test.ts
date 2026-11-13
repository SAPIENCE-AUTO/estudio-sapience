import { describe, expect, it } from 'vitest';
import { crearOActualizar, entrar, llamar, mensajeDeParticipante, pasarASesion, sesionDelEvento, unirseEquipo, type Sesion } from '../server/dominio';
import { estadoParaEquipo, estadoParaParticipante } from '../server/vistas';

const LLAVE = 'llave-de-prueba-1234'; // inventada: no es una llave real

describe('sesión por evento del Hub', () => {
  it('apretar el botón dos veces para el mismo evento devuelve la misma sesión, no crea otra', () => {
    const todas: Record<string, Sesion> = {};
    const a = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1', muxLlave: LLAVE });
    const b = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1', muxLlave: LLAVE });
    expect(a.yaExistia).toBe(false);
    expect(b.yaExistia).toBe(true);
    expect(b.sesion.id).toBe(a.sesion.id);
    expect(b.cambio).toBe(false);
    expect(Object.keys(todas)).toHaveLength(1);
  });

  it('eventos distintos tienen sesiones distintas, y sin evento siempre se crea una nueva', () => {
    const todas: Record<string, Sesion> = {};
    const a = crearOActualizar(todas, 'A', { externoId: 'evento-1' }).sesion;
    const b = crearOActualizar(todas, 'B', { externoId: 'evento-2' }).sesion;
    const c = crearOActualizar(todas, 'C').sesion;
    const d = crearOActualizar(todas, 'C').sesion;
    expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
  });

  it('si el Hub manda otra llave o renombra el evento, la sesión existente se actualiza y sube la versión', () => {
    const todas: Record<string, Sesion> = {};
    const a = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1', muxLlave: LLAVE }).sesion;
    const v = a.version;
    const b = crearOActualizar(todas, 'Grupo 1 (renombrado)', { externoId: 'evento-1', muxLlave: 'otra-llave-9999' });
    expect(b.sesion.id).toBe(a.id);
    expect(b.cambio).toBe(true);
    expect(b.sesion.nombre).toBe('Grupo 1 (renombrado)');
    expect(b.sesion.muxLlave).toBe('otra-llave-9999');
    expect(b.sesion.version).toBe(v + 1);
  });

  it('si no manda llave, no se pierde la que ya tenía', () => {
    const todas: Record<string, Sesion> = {};
    crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1', muxLlave: LLAVE });
    const b = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1' });
    expect(b.sesion.muxLlave).toBe(LLAVE);
  });

  it('una sesión terminada no cuenta: si el evento vuelve a empezar se crea una nueva', () => {
    const todas: Record<string, Sesion> = {};
    const a = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1' }).sesion;
    a.terminada = true;
    expect(sesionDelEvento(todas, 'evento-1')).toBeUndefined();
    const b = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1' });
    expect(b.yaExistia).toBe(false);
    expect(b.sesion.id).not.toBe(a.id);
  });
});

describe('la llave de transmisión nunca sale del servidor', () => {
  it('no aparece en el estado del equipo ni en el de ningún participante (en ningún lugar de la sesión)', () => {
    const todas: Record<string, Sesion> = {};
    const s = crearOActualizar(todas, 'Grupo 1', { externoId: 'evento-1', muxLlave: LLAVE, observacionUrl: 'https://ejemplo.test/s/abc' }).sesion;
    const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
    const ana = entrar(s, 'Ana');
    llamar(s, ana.id, eq); pasarASesion(s, ana.id);
    mensajeDeParticipante(s, ana.id, 'hola');
    expect(JSON.stringify(estadoParaEquipo(s, eq))).not.toContain(LLAVE);
    expect(JSON.stringify(estadoParaParticipante(s, ana.id))).not.toContain(LLAVE);
    const lobby = entrar(s, 'Beto');
    expect(JSON.stringify(estadoParaParticipante(s, lobby.id))).not.toContain(LLAVE);
  });
});
