import { describe, expect, it } from 'vitest';
import { ErrorDominio, bajar, entrar, llamar, mensajeDeParticipante, mensajeDelEquipo, nuevaSesion, pasarASesion, ponerChat, regresarALobby, subir, unirseEquipo, type Sesion } from '../server/dominio';
import { estadoParaEquipo, estadoParaParticipante, mensajesParaParticipante } from '../server/vistas';

/** Una sesión con un miembro del equipo y tres participantes ya en backstage (datos inventados). */
function sesion(): { s: Sesion; eq: string; ana: string; beto: string; carla: string } {
  const s = nuevaSesion('Prueba');
  const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
  const gente = ['Ana', 'Beto', 'Carla'].map((n) => { const p = entrar(s, n); llamar(s, p.id, eq); pasarASesion(s, p.id); return p.id; });
  return { s, eq, ana: gente[0]!, beto: gente[1]!, carla: gente[2]! };
}
const textos = (s: Sesion, pid: string) => mensajesParaParticipante(s, pid).map((m) => m.texto);

describe('chat de la sesión (backstage y escenario): quién puede leer qué', () => {
  it('el chat del equipo NUNCA llega a un participante', () => {
    const { s, eq, ana } = sesion();
    mensajeDelEquipo(s, eq, 'equipo', 'secreto del equipo', 'equipo');
    expect(textos(s, ana)).toEqual([]);
    expect(JSON.stringify(estadoParaParticipante(s, ana))).not.toContain('secreto del equipo');
  });

  it('lo que un participante le escribe al equipo lo ve el equipo y él, y nadie más (modo «solo con el equipo»)', () => {
    const { s, ana, beto } = sesion();
    mensajeDeParticipante(s, ana, 'hola equipo');
    expect(textos(s, ana)).toEqual(['hola equipo']);
    expect(textos(s, beto)).toEqual([]);
    expect(estadoParaEquipo(s, 'x').mensajes.map((m) => m.texto)).toEqual(['hola equipo']);
    expect(JSON.stringify(estadoParaParticipante(s, beto))).not.toContain('hola equipo');
  });

  it('una respuesta a una persona solo la lee esa persona; a todos la leen todos', () => {
    const { s, eq, ana, beto, carla } = sesion();
    mensajeDelEquipo(s, eq, 'sesion', 'solo para Ana', ana);
    expect(textos(s, ana)).toEqual(['solo para Ana']);
    expect(textos(s, beto)).toEqual([]);
    mensajeDelEquipo(s, eq, 'sesion', 'para todos', 'todos');
    for (const p of [ana, beto, carla]) expect(textos(s, p)).toContain('para todos');
    expect(JSON.stringify(estadoParaParticipante(s, beto))).not.toContain('solo para Ana');
  });

  it('a quien lee su propia respuesta privada se le marca «tu»; lo demás conserva su destino', () => {
    const { s, eq, ana } = sesion();
    mensajeDelEquipo(s, eq, 'sesion', 'a Ana', ana);
    mensajeDelEquipo(s, eq, 'sesion', 'a todos', 'todos');
    expect(mensajesParaParticipante(s, ana).map((m) => m.para)).toEqual(['tu', 'todos']);
  });
});

describe('chat de la sesión: modo grupal y abrir o cerrar', () => {
  it('en modo grupal los participantes se leen entre sí', () => {
    const { s, ana, beto } = sesion();
    ponerChat(s, { abierto: true, grupal: true });
    mensajeDeParticipante(s, ana, 'hola a todos');
    expect(textos(s, beto)).toEqual(['hola a todos']);
  });

  it('lo escrito ANTES de pasar a grupal sigue siendo privado: el modo se decide al escribir, no al leer', () => {
    const { s, ana, beto } = sesion();
    mensajeDeParticipante(s, ana, 'esto era para el equipo');
    ponerChat(s, { abierto: true, grupal: true });
    expect(textos(s, beto)).toEqual([]);
    mensajeDeParticipante(s, ana, 'esto ya es de grupo');
    expect(textos(s, beto)).toEqual(['esto ya es de grupo']);
    ponerChat(s, { abierto: true, grupal: false });
    mensajeDeParticipante(s, ana, 'otra vez privado');
    expect(textos(s, beto)).toEqual(['esto ya es de grupo']); // lo de grupo se conserva, lo nuevo no
  });

  it('con el chat cerrado nadie escribe y los participantes no leen nada de la sesión', () => {
    const { s, eq, ana } = sesion();
    mensajeDeParticipante(s, ana, 'antes de cerrar');
    mensajeDelEquipo(s, eq, 'sesion', 'aviso a todos', 'todos');
    ponerChat(s, { abierto: false, grupal: false });
    expect(() => mensajeDeParticipante(s, ana, 'cerrado')).toThrow(ErrorDominio);
    expect(textos(s, ana)).toEqual([]);
    ponerChat(s, { abierto: true, grupal: false });
    expect(textos(s, ana)).toEqual(['antes de cerrar', 'aviso a todos']);
  });

  it('cambiar el chat sube la versión solo si algo cambió', () => {
    const { s } = sesion();
    const v = s.version;
    expect(ponerChat(s, { abierto: true, grupal: false }).cambio).toBe(false);
    expect(s.version).toBe(v);
    expect(ponerChat(s, { abierto: false, grupal: false }).cambio).toBe(true);
    expect(s.version).toBe(v + 1);
  });
});

describe('chat de la sala verde', () => {
  it('quien está en la sala verde escribe ahí; lo ve el equipo y esa persona, nadie más', () => {
    const s = nuevaSesion('Prueba');
    const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
    const ana = entrar(s, 'Ana'); const beto = entrar(s, 'Beto');
    llamar(s, ana.id, eq); llamar(s, beto.id, eq);
    mensajeDeParticipante(s, ana.id, 'mi audio no se oye');
    mensajeDelEquipo(s, eq, 'verde', 'Prueba con otros audífonos', ana.id);
    expect(textos(s, ana.id)).toEqual(['mi audio no se oye', 'Prueba con otros audífonos']);
    expect(textos(s, beto.id)).toEqual([]);
    expect(estadoParaEquipo(s, eq).mensajes.map((m) => m.canal)).toEqual(['verde', 'verde']);
  });

  it('el chat de la sala verde no llega a quien ya pasó a backstage', () => {
    const s = nuevaSesion('Prueba');
    const eq = unirseEquipo(s, 'moderadora@ejemplo.test', 'Marina').id;
    const ana = entrar(s, 'Ana');
    llamar(s, ana.id, eq);
    mensajeDelEquipo(s, eq, 'verde', 'dato de la sala verde', ana.id);
    pasarASesion(s, ana.id);
    expect(textos(s, ana.id)).toEqual([]);
    expect(JSON.stringify(estadoParaParticipante(s, ana.id))).not.toContain('dato de la sala verde');
  });

  it('el equipo solo puede escribirle a la sala verde a alguien que está ahí', () => {
    const { s, eq, ana } = sesion(); // Ana ya está en backstage
    expect(() => mensajeDelEquipo(s, eq, 'verde', 'hola', ana)).toThrow(ErrorDominio);
  });

  it('en el lobby todavía no se puede escribir', () => {
    const s = nuevaSesion('Prueba');
    const p = entrar(s, 'Ana');
    expect(() => mensajeDeParticipante(s, p.id, 'hola')).toThrow(ErrorDominio);
  });
});

describe('chat: lo que depende de DÓNDE está la persona', () => {
  it('quien vuelve al lobby ya no lee el chat de la sesión, y al volver a backstage lo recupera', () => {
    const { s, eq, ana } = sesion();
    mensajeDelEquipo(s, eq, 'sesion', 'dato de la sesión', 'todos');
    regresarALobby(s, ana);
    expect(textos(s, ana)).toEqual([]);
    llamar(s, ana, eq); pasarASesion(s, ana);
    expect(textos(s, ana)).toEqual(['dato de la sesión']);
  });

  it('quien aún no entra a backstage no puede leer el chat de grupo aunque ya existiera', () => {
    const { s, ana } = sesion();
    ponerChat(s, { abierto: true, grupal: true });
    mensajeDeParticipante(s, ana, 'charla de grupo');
    const nuevo = entrar(s, 'Dora'); // sigue en el lobby
    expect(textos(s, nuevo.id)).toEqual([]);
    expect(JSON.stringify(estadoParaParticipante(s, nuevo.id))).not.toContain('charla de grupo');
  });

  it('subir y bajar al escenario no cambia lo que lee: sigue «adentro»', () => {
    const { s, eq, ana } = sesion();
    mensajeDelEquipo(s, eq, 'sesion', 'sigue visible', 'todos');
    subir(s, ana);
    expect(textos(s, ana)).toEqual(['sigue visible']);
    bajar(s, ana);
    expect(textos(s, ana)).toEqual(['sigue visible']);
  });
});

describe('chat: reglas de escritura', () => {
  it('no se aceptan mensajes vacíos, se limpian los espacios y se recorta lo muy largo', () => {
    const { s, ana } = sesion();
    expect(() => mensajeDeParticipante(s, ana, '   \n  ')).toThrow(ErrorDominio);
    expect(mensajeDeParticipante(s, ana, '  hola    mundo  ').texto).toBe('hola mundo');
    expect(mensajeDeParticipante(s, ana, 'x'.repeat(5000)).texto.length).toBe(500);
  });

  it('el equipo no puede escribirle a alguien que no existe', () => {
    const { s, eq } = sesion();
    expect(() => mensajeDelEquipo(s, eq, 'sesion', 'hola', 'p_inventado')).toThrow(ErrorDominio);
  });

  it('cada mensaje sube la versión (así llega a todas las pantallas) y solo se guardan los últimos 300', () => {
    const { s, ana } = sesion();
    const v = s.version;
    mensajeDeParticipante(s, ana, 'uno');
    expect(s.version).toBe(v + 1);
    for (let i = 0; i < 400; i++) mensajeDeParticipante(s, ana, `m${i}`);
    expect(s.mensajes!.length).toBe(300);
    expect(s.mensajes![299]!.texto).toBe('m399');
  });
});
