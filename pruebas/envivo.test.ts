import { describe, expect, it } from 'vitest';
import { crearFirmador } from '../server/acceso';
import { detenerEnVivo, entrar, ErrorDominio, iniciarEnVivo, llamar, mensajeDeParticipante, mensajeDelEquipo, nuevaSesion, pasarASesion, ponerDiseno, subir, unirseEquipo, ponerMiembroEnEscenario, type Sesion } from '../server/dominio';
import { estadoParaEquipo, estadoParaGrabadora, estadoParaParticipante } from '../server/vistas';

const LLAVE = 'llave-de-prueba-1234'; // inventada

/** Una sesión con gente en cada lugar (datos inventados): Marina y Ana en el escenario, Beto en backstage, Carla en la sala verde, Dora en el lobby. */
function sesionConGente(): { s: Sesion; eq: string; ana: string; beto: string; carla: string; dora: string } {
  const s = nuevaSesion('Prueba', Date.now(), { externoId: 'evento-1', muxLlave: LLAVE });
  const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
  ponerMiembroEnEscenario(s, eq, true);
  const entra = (nombre: string) => entrar(s, nombre).id;
  const ana = entra('Ana'); llamar(s, ana, eq); pasarASesion(s, ana); subir(s, ana);
  const beto = entra('Beto'); llamar(s, beto, eq); pasarASesion(s, beto);
  const carla = entra('Carla'); llamar(s, carla, eq);
  const dora = entra('Dora');
  mensajeDeParticipante(s, beto, 'mensaje privado de Beto');
  mensajeDelEquipo(s, eq, 'equipo', 'nota interna del equipo', 'equipo');
  mensajeDelEquipo(s, eq, 'verde', 'dato de la sala verde', carla);
  return { s, eq, ana, beto, carla, dora };
}

describe('lo que ve la página que se transmite', () => {
  it('solo trae a quienes están en el escenario, con su nombre, y el diseño', () => {
    const { s, eq, ana } = sesionConGente();
    ponerDiseno(s, { tipo: 'foco', fijado: ana, forma: 'circulo', ajuste: 'completo', fondo: 'negro' });
    const g = estadoParaGrabadora(s);
    expect(g.escena).toEqual([{ id: eq, nombre: 'Marina' }, { id: ana, nombre: 'Ana' }]);
    expect(g.diseno).toEqual({ tipo: 'foco', fijado: ana, forma: 'circulo', ajuste: 'completo', fondo: 'negro' });
  });

  it('NO trae a nadie de backstage, sala verde ni lobby, ni ningún chat, ni la llave de Mux', () => {
    const { s } = sesionConGente();
    const texto = JSON.stringify(estadoParaGrabadora(s));
    for (const fuera of ['Beto', 'Carla', 'Dora', 'mensaje privado de Beto', 'nota interna del equipo', 'dato de la sala verde', LLAVE, 'moderadora@ejemplo.test']) {
      expect(texto).not.toContain(fuera);
    }
  });

  it('cuando alguien sube o baja del escenario, la página lo refleja (es lo que se emite)', () => {
    const { s, beto } = sesionConGente();
    subir(s, beto);
    expect(estadoParaGrabadora(s).escena.map((p) => p.nombre)).toEqual(['Marina', 'Ana', 'Beto']);
  });
});

describe('empezar y terminar EN VIVO', () => {
  it('sin llave de Mux no se puede empezar', () => {
    const s = nuevaSesion('Sin llave');
    expect(() => iniciarEnVivo(s, 'EG_1')).toThrow(ErrorDominio);
  });

  it('empezar guarda desde cuándo, sube la versión y no se puede empezar dos veces', () => {
    const { s } = sesionConGente();
    const v = s.version;
    iniciarEnVivo(s, 'EG_1', 1_000_000);
    expect(s.envivo).toEqual({ egressId: 'EG_1', desde: 1_000_000 });
    expect(s.version).toBe(v + 1);
    expect(() => iniciarEnVivo(s, 'EG_2')).toThrow(ErrorDominio);
  });

  it('terminar devuelve el identificador para pararlo en LiveKit y deja todo limpio; sin transmisión devuelve null', () => {
    const { s } = sesionConGente();
    expect(detenerEnVivo(s)).toBeNull();
    iniciarEnVivo(s, 'EG_1');
    expect(detenerEnVivo(s)).toBe('EG_1');
    expect(s.envivo).toBeUndefined();
    iniciarEnVivo(s, 'EG_3'); // se puede volver a empezar
    expect(s.envivo?.egressId).toBe('EG_3');
  });

  it('una sesión terminada no puede empezar a transmitir', () => {
    const { s } = sesionConGente();
    s.terminada = true;
    expect(() => iniciarEnVivo(s, 'EG_1')).toThrow(ErrorDominio);
  });
});

describe('qué se sabe de la transmisión desde cada pantalla', () => {
  it('el equipo y los participantes saben que está en vivo y desde cuándo, pero NUNCA el identificador interno ni la llave', () => {
    const { s, eq, ana, dora } = sesionConGente();
    iniciarEnVivo(s, 'EG_secreto_123', 5_000);
    const equipo = estadoParaEquipo(s, eq);
    expect(equipo.envivo).toEqual({ desde: 5_000 });
    expect(equipo.transmision).toBe('lista');
    for (const pid of [ana, dora]) {
      const e = estadoParaParticipante(s, pid)!;
      expect(e.envivo).toEqual({ desde: 5_000 }); // también el que está en el lobby: tiene derecho a saber
      const t = JSON.stringify(e);
      expect(t).not.toContain('EG_secreto_123');
      expect(t).not.toContain(LLAVE);
    }
    expect(JSON.stringify(equipo)).not.toContain('EG_secreto_123');
    expect(JSON.stringify(equipo)).not.toContain(LLAVE);
  });

  it('sin transmisión, «envivo» es null; sin llave se avisa «sin-llave»', () => {
    const s = nuevaSesion('Sin llave');
    const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
    const e = estadoParaEquipo(s, eq);
    expect(e.envivo).toBeNull();
    expect(e.transmision).toBe('sin-llave');
  });
});

describe('el boleto de la grabadora', () => {
  const sellos = crearFirmador('x'.repeat(40));
  it('sirve para su sesión y para nada más: un boleto de otro tipo no abre la grabadora, ni al revés', () => {
    const boleto = sellos.firmar('grabadora', { sid: 's1' }, 60_000);
    expect(sellos.leer<{ sid: string }>('grabadora', boleto)?.sid).toBe('s1');
    expect(sellos.leer('pase', boleto)).toBeNull();
    expect(sellos.leer('boleto', boleto)).toBeNull();
    const pase = sellos.firmar('pase', { sid: 's1', pid: 'p_1' }, 60_000);
    expect(sellos.leer('grabadora', pase)).toBeNull();
  });
  it('vence y no se puede alterar', () => {
    const vencido = sellos.firmar('grabadora', { sid: 's1' }, -1000);
    expect(sellos.leer('grabadora', vencido)).toBeNull();
    const boleto = sellos.firmar('grabadora', { sid: 's1' }, 60_000);
    expect(sellos.leer('grabadora', boleto.slice(0, -2) + 'xx')).toBeNull();
  });
});
