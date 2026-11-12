import { describe, expect, it } from 'vitest';
import * as d from '../server/dominio';

function sesionConEquipo() {
  const s = d.nuevaSesion('Grupo 1');
  const eq = d.unirseEquipo(s, 'ana@ejemplo.test', 'Ana');
  const eq2 = d.unirseEquipo(s, 'beto@ejemplo.test', 'Beto');
  return { s, eq, eq2 };
}

describe('entrar', () => {
  it('cae en el lobby y sube la versión', () => {
    const { s } = sesionConEquipo();
    const v0 = s.version;
    const p = d.entrar(s, '  Mariana   T. ');
    expect(p.lugar).toBe('lobby');
    expect(p.nombre).toBe('Mariana T.');
    expect(s.version).toBe(v0 + 1);
  });
  it('rechaza un nombre vacío', () => {
    const { s } = sesionConEquipo();
    expect(() => d.entrar(s, '   ')).toThrow();
  });
});

describe('sala verde y sesión', () => {
  it('llamar, pasar a la sesión y regresar al lobby', () => {
    const { s, eq } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    expect(d.llamar(s, p.id, eq.id).cambio).toBe(true);
    expect(s.participantes[p.id]).toMatchObject({ lugar: 'verde', verdeCon: eq.id });
    expect(d.pasarASesion(s, p.id).cambio).toBe(true);
    expect(s.participantes[p.id]).toMatchObject({ lugar: 'backstage', verdeCon: null });
    expect(d.regresarALobby(s, p.id).cambio).toBe(true);
    expect(s.participantes[p.id].lugar).toBe('lobby');
  });
  it('no se pasa a la sesión a quien sigue en el lobby', () => {
    const { s } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    expect(() => d.pasarASesion(s, p.id)).toThrow();
  });
  it('otra persona del equipo no le quita a alguien que ya tiene en la sala verde', () => {
    const { s, eq, eq2 } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    d.llamar(s, p.id, eq.id);
    expect(() => d.llamar(s, p.id, eq2.id)).toThrow();
  });
  it('desde backstage o escenario se regresa a la sala verde', () => {
    const { s, eq } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    d.llamar(s, p.id, eq.id); d.pasarASesion(s, p.id); d.subir(s, p.id);
    expect(d.llamar(s, p.id, eq.id)).toEqual({ cambio: true, de: 'escenario' });
    expect(s.participantes[p.id].lugar).toBe('verde');
  });
});

describe('subir y bajar', () => {
  it('solo sube quien está en backstage y solo baja quien está en el escenario', () => {
    const { s, eq } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    expect(() => d.subir(s, p.id)).toThrow();     // en el lobby no se sube
    expect(() => d.bajar(s, p.id)).toThrow();     // ni se baja a quien no está en el escenario
    d.llamar(s, p.id, eq.id); d.pasarASesion(s, p.id);
    expect(d.bajar(s, p.id).cambio).toBe(false);  // en backstage ya está abajo: no hace nada
    expect(d.subir(s, p.id).cambio).toBe(true);
    expect(d.bajar(s, p.id).cambio).toBe(true);
  });
  it('repetir una acción no cambia nada ni sube la versión', () => {
    const { s, eq } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    d.llamar(s, p.id, eq.id); d.pasarASesion(s, p.id); d.subir(s, p.id);
    const v = s.version;
    expect(d.subir(s, p.id).cambio).toBe(false);
    expect(d.pasarASesion(s, p.id).cambio).toBe(false);
    expect(() => d.llamar(s, 'p_inexistente', eq.id)).toThrow();
    expect(s.version).toBe(v);
  });
});

describe('sesión terminada', () => {
  it('ya no deja entrar ni mover', () => {
    const { s, eq } = sesionConEquipo();
    const p = d.entrar(s, 'Mariana');
    d.terminar(s);
    expect(() => d.entrar(s, 'Otra')).toThrow();
    expect(() => d.llamar(s, p.id, eq.id)).toThrow();
  });
});

describe('ráfagas', () => {
  it('después de miles de acciones al azar el estado siempre es válido y la versión nunca baja', () => {
    const { s, eq, eq2 } = sesionConEquipo();
    const ids = Array.from({ length: 8 }, (_, i) => d.entrar(s, 'P' + i).id);
    const acciones = [
      (id: string) => d.llamar(s, id, Math.random() < 0.5 ? eq.id : eq2.id),
      (id: string) => d.pasarASesion(s, id),
      (id: string) => d.regresarALobby(s, id),
      (id: string) => d.subir(s, id),
      (id: string) => d.bajar(s, id),
    ];
    let vPrevia = s.version;
    for (let i = 0; i < 5000; i++) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      try { acciones[Math.floor(Math.random() * acciones.length)](id); } catch (e) { expect(e).toBeInstanceOf(d.ErrorDominio); }
      expect(s.version).toBeGreaterThanOrEqual(vPrevia);
      vPrevia = s.version;
      for (const p of Object.values(s.participantes)) {
        expect(['lobby', 'verde', 'backstage', 'escenario']).toContain(p.lugar);
        expect(p.lugar === 'verde').toBe(p.verdeCon !== null);
      }
    }
  });
});
