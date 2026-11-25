import { describe, expect, it } from 'vitest';
import { detenerPantalla, empezarPantalla, entrar, ErrorDominio, llamar, marcarConexion, nuevaSesion, pasarASesion, ponerMiembroEnEscenario, ponerPantallaEnEscenario, subir, terminar, unirseEquipo, type Sesion } from '../server/dominio';
import { estadoParaEquipo, estadoParaGrabadora, estadoParaParticipante } from '../server/vistas';

/** Datos inventados: Marina (modera) y Pablo (producción) del equipo; Ana en el escenario, Beto en backstage, Carla en la sala verde, Dora en el lobby. */
function sesionConGente() {
  const s = nuevaSesion('Prueba');
  const marina = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
  const pablo = unirseEquipo(s, 'produccion@ejemplo.test', 'Pablo').id;
  ponerMiembroEnEscenario(s, marina, true);
  const entra = (n: string) => entrar(s, n).id;
  const ana = entra('Ana'); llamar(s, ana, marina); pasarASesion(s, ana); subir(s, ana);
  const beto = entra('Beto'); llamar(s, beto, marina); pasarASesion(s, beto);
  const carla = entra('Carla'); llamar(s, carla, marina);
  const dora = entra('Dora');
  return { s, marina, pablo, ana, beto, carla, dora };
}
const codigo = (f: () => unknown) => { try { f(); return 'OK'; } catch (e) { return e instanceof ErrorDominio ? e.codigo : `otro: ${String(e)}`; } };

describe('compartir pantalla: reglas', () => {
  it('empieza en backstage (no está en el escenario) y sube la versión', () => {
    const { s, pablo } = sesionConGente();
    const v = s.version;
    expect(empezarPantalla(s, pablo, 'presentacion', false, 1000).cambio).toBe(true);
    expect(s.pantalla).toEqual({ de: pablo, nombre: 'Pablo', modo: 'presentacion', audio: false, enEscenario: false, desde: 1000 });
    expect(s.version).toBe(v + 1);
  });

  it('repetir lo mismo no cambia nada (un doble clic no estorba)', () => {
    const { s, pablo } = sesionConGente();
    empezarPantalla(s, pablo, 'video', true);
    const v = s.version;
    expect(empezarPantalla(s, pablo, 'video', true).cambio).toBe(false);
    expect(s.version).toBe(v);
  });

  it('solo UNA a la vez: si otra persona ya comparte, no se puede', () => {
    const { s, marina, pablo } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    expect(codigo(() => empezarPantalla(s, marina, 'video', true))).toBe('NO_PERMITIDO');
    expect(s.pantalla?.de).toBe(pablo);
  });

  it('quien ya comparte puede cambiar de modo o de sonido sin perder si estaba en el escenario ni desde cuándo', () => {
    const { s, pablo } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false, 1000);
    ponerPantallaEnEscenario(s, pablo, true);
    empezarPantalla(s, pablo, 'video', true, 5000);
    expect(s.pantalla).toMatchObject({ modo: 'video', audio: true, enEscenario: true, desde: 1000 });
  });

  it('solo comparte quien es del equipo y está en la sesión; un participante no', () => {
    const { s, ana } = sesionConGente();
    expect(codigo(() => empezarPantalla(s, ana, 'presentacion', false))).toBe('NO_ENCONTRADO');
    expect(codigo(() => empezarPantalla(s, 'eq_que_no_existe', 'presentacion', false))).toBe('NO_ENCONTRADO');
  });

  it('un modo inventado se rechaza', () => {
    const { s, pablo } = sesionConGente();
    expect(codigo(() => empezarPantalla(s, pablo, 'cualquiera' as never, false))).toBe('NO_PERMITIDO');
  });

  it('cualquiera del equipo puede subirla al escenario, bajarla o quitarla (quien modera corta lo que comparte producción)', () => {
    const { s, marina, pablo } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    expect(ponerPantallaEnEscenario(s, marina, true).cambio).toBe(true);
    expect(ponerPantallaEnEscenario(s, marina, true).cambio).toBe(false);
    expect(ponerPantallaEnEscenario(s, marina, false).cambio).toBe(true);
    expect(detenerPantalla(s, marina).cambio).toBe(true);
    expect(s.pantalla).toBeUndefined();
    expect(detenerPantalla(s, marina).cambio).toBe(false);
  });

  it('no se puede subir una pantalla que nadie comparte', () => {
    const { s, marina } = sesionConGente();
    expect(codigo(() => ponerPantallaEnEscenario(s, marina, true))).toBe('NO_ENCONTRADO');
  });

  it('un participante no puede subirla ni quitarla', () => {
    const { s, pablo, ana } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    expect(codigo(() => ponerPantallaEnEscenario(s, ana, true))).toBe('NO_ENCONTRADO');
    expect(codigo(() => detenerPantalla(s, ana))).toBe('NO_ENCONTRADO');
    expect(s.pantalla?.enEscenario).toBe(false);
  });

  it('si quien comparte se desconecta, la pantalla se quita; si se desconecta otra persona, no', () => {
    const { s, marina, pablo, ana } = sesionConGente();
    marcarConexion(s, { equipoId: pablo }, true); marcarConexion(s, { equipoId: marina }, true);
    empezarPantalla(s, pablo, 'presentacion', false);
    marcarConexion(s, { equipoId: marina }, false);
    marcarConexion(s, { participanteId: ana }, true); marcarConexion(s, { participanteId: ana }, false);
    expect(s.pantalla?.de).toBe(pablo);
    marcarConexion(s, { equipoId: pablo }, false);
    expect(s.pantalla).toBeUndefined();
  });

  it('terminar la sesión quita la pantalla, y ya no se puede empezar otra', () => {
    const { s, marina, pablo } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    terminar(s);
    expect(s.pantalla).toBeUndefined();
    expect(codigo(() => empezarPantalla(s, marina, 'presentacion', false))).toBe('SESION_TERMINADA');
  });
});

describe('compartir pantalla: quién la ve', () => {
  it('el equipo la ve completa, en backstage y en el escenario', () => {
    const { s, marina, pablo } = sesionConGente();
    expect(estadoParaEquipo(s, marina).pantalla).toBeNull();
    empezarPantalla(s, pablo, 'video', true, 1000);
    expect(estadoParaEquipo(s, marina).pantalla).toEqual({ de: pablo, nombre: 'Pablo', audio: true, modo: 'video', enEscenario: false, desde: 1000 });
    ponerPantallaEnEscenario(s, pablo, true);
    expect(estadoParaEquipo(s, marina).pantalla?.enEscenario).toBe(true);
  });

  it('mientras está en backstage NINGÚN participante ni la transmisión sabe que existe', () => {
    const { s, pablo, ana, beto, carla, dora } = sesionConGente();
    empezarPantalla(s, pablo, 'video', true);
    for (const pid of [ana, beto, carla, dora]) expect(estadoParaParticipante(s, pid)!.pantalla).toBeNull();
    expect(estadoParaGrabadora(s).pantalla).toBeNull();
    // El nombre del equipo sí se ve siempre (Pablo es del equipo); lo que NO debe salir es nada de la pantalla.
    const texto = JSON.stringify([estadoParaParticipante(s, ana), estadoParaParticipante(s, beto), estadoParaGrabadora(s)]);
    expect(texto).not.toContain('"pantalla":{');
    expect(texto).not.toContain('"audio"');
  });

  it('en el escenario la ven y la oyen quienes están adentro (escenario y backstage) y la transmisión; el lobby y la sala verde no', () => {
    const { s, pablo, ana, beto, carla, dora } = sesionConGente();
    empezarPantalla(s, pablo, 'video', true);
    ponerPantallaEnEscenario(s, pablo, true);
    const esperada = { de: pablo, nombre: 'Pablo', audio: true };
    expect(estadoParaParticipante(s, ana)!.pantalla).toEqual(esperada);
    expect(estadoParaParticipante(s, beto)!.pantalla).toEqual(esperada);
    expect(estadoParaGrabadora(s).pantalla).toEqual(esperada);
    expect(estadoParaParticipante(s, carla)!.pantalla).toBeNull();
    expect(estadoParaParticipante(s, dora)!.pantalla).toBeNull();
  });

  it('lo que sale fuera del equipo no trae el modo, ni desde cuándo, ni nada más', () => {
    const { s, pablo, ana } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    ponerPantallaEnEscenario(s, pablo, true);
    expect(Object.keys(estadoParaParticipante(s, ana)!.pantalla!).sort()).toEqual(['audio', 'de', 'nombre']);
    expect(Object.keys(estadoParaGrabadora(s).pantalla!).sort()).toEqual(['audio', 'de', 'nombre']);
  });

  it('al bajarla o quitarla deja de verse fuera del equipo', () => {
    const { s, pablo, ana } = sesionConGente();
    empezarPantalla(s, pablo, 'presentacion', false);
    ponerPantallaEnEscenario(s, pablo, true);
    ponerPantallaEnEscenario(s, pablo, false);
    expect(estadoParaParticipante(s, ana)!.pantalla).toBeNull();
    ponerPantallaEnEscenario(s, pablo, true);
    detenerPantalla(s, pablo);
    expect(estadoParaParticipante(s, ana)!.pantalla).toBeNull();
    expect(estadoParaGrabadora(s).pantalla).toBeNull();
  });
});

describe('compartir pantalla: sesiones guardadas', () => {
  it('una sesión guardada sin pantalla sigue funcionando (el campo es opcional)', () => {
    const s: Sesion = { ...sesionConGente().s };
    delete s.pantalla;
    const { marina } = sesionConGente();
    expect(estadoParaGrabadora(s).pantalla).toBeNull();
    expect(estadoParaEquipo(s, marina).pantalla).toBeNull();
  });
});
