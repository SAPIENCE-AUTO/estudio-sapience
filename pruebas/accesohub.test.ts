import { describe, expect, it } from 'vitest';
import { crearFirmador } from '../server/acceso';
import { crearBuzonDePases, destinoDeSesion, ID_SESION, TTL_PASE_HUB_MS, TTL_SESION_EQUIPO_MS } from '../server/accesoHub';

const persona = { email: 'ana@ejemplo.test', nombre: 'Ana', destino: '/equipo/s1' };

describe('pase de un solo uso del Hub', () => {
  it('lo emitido se canjea y devuelve a la persona y a dónde ir', () => {
    const b = crearBuzonDePases();
    const codigo = b.emitir(persona);
    expect(b.canjear(codigo)).toEqual(persona);
  });

  it('solo sirve UNA vez', () => {
    const b = crearBuzonDePases();
    const codigo = b.emitir(persona);
    expect(b.canjear(codigo)).not.toBeNull();
    expect(b.canjear(codigo)).toBeNull();
    expect(b.cuantos()).toBe(0);
  });

  it('vale 60 segundos: dentro del plazo sirve, pasado el plazo no', () => {
    let t = 1_000_000;
    const b = crearBuzonDePases({ ahora: () => t });
    const bueno = b.emitir(persona);
    const tarde = b.emitir(persona);
    t += TTL_PASE_HUB_MS - 1;
    expect(b.canjear(bueno)).not.toBeNull();
    t += 2;
    expect(b.canjear(tarde)).toBeNull();
  });

  it('un pase vencido también se gasta (no queda guardado para siempre)', () => {
    let t = 1_000_000;
    const b = crearBuzonDePases({ ahora: () => t });
    const codigo = b.emitir(persona);
    t += TTL_PASE_HUB_MS + 1;
    expect(b.canjear(codigo)).toBeNull();
    expect(b.cuantos()).toBe(0);
  });

  it('un código inventado, vacío o que no es texto no sirve', () => {
    const b = crearBuzonDePases();
    b.emitir(persona);
    for (const malo of ['', 'abc', 'x'.repeat(500), 'no-existe-este-codigo', undefined, null, 42, {}, ['a']]) expect(b.canjear(malo)).toBeNull();
  });

  it('cada pase es distinto y largo (256 bits, no se adivina)', () => {
    const b = crearBuzonDePases();
    const codigos = new Set(Array.from({ length: 200 }, () => b.emitir(persona)));
    expect(codigos.size).toBe(200);
    for (const c of codigos) expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('cada pase es de UNA persona: no se mezclan', () => {
    const b = crearBuzonDePases();
    const a = b.emitir({ email: 'ana@ejemplo.test', nombre: 'Ana', destino: '/' });
    const c = b.emitir({ email: 'beto@ejemplo.test', nombre: 'Beto', destino: '/equipo/s2' });
    expect(b.canjear(c)?.email).toBe('beto@ejemplo.test');
    expect(b.canjear(a)?.email).toBe('ana@ejemplo.test');
  });

  it('tiene tope: si se llena, se descartan los más viejos y la memoria no crece sin fin', () => {
    const b = crearBuzonDePases({ maximo: 5 });
    const codigos = Array.from({ length: 12 }, () => b.emitir(persona));
    expect(b.cuantos()).toBeLessThanOrEqual(5);
    expect(b.canjear(codigos[0])).toBeNull(); // el más viejo ya no está
    expect(b.canjear(codigos[11])).not.toBeNull(); // el último sí
  });

  it('al llenarse primero se limpian los vencidos', () => {
    let t = 1_000_000;
    const b = crearBuzonDePases({ ahora: () => t, maximo: 3 });
    const viejos = [b.emitir(persona), b.emitir(persona), b.emitir(persona)];
    t += TTL_PASE_HUB_MS + 1;
    const nuevo = b.emitir(persona);
    expect(b.cuantos()).toBe(1);
    expect(b.canjear(nuevo)).not.toBeNull();
    for (const v of viejos) expect(b.canjear(v)).toBeNull();
  });
});

describe('a dónde lleva el pase', () => {
  it('sin sesión va al inicio del equipo; con sesión, a su consola', () => {
    expect(destinoDeSesion()).toBe('/');
    expect(destinoDeSesion(null)).toBe('/');
    expect(destinoDeSesion('s1a2b3c4d5e')).toBe('/equipo/s1a2b3c4d5e');
  });

  it('nunca arma una dirección de afuera ni con caracteres raros', () => {
    for (const malo of ['//evil.test', 'https://evil.test', '../x', 'a/b', 'a b', 'a?b=1', 'a#b', 'x'.repeat(65), '<script>']) {
      expect(ID_SESION.test(malo)).toBe(false);
      expect(() => destinoDeSesion(malo)).toThrow();
    }
  });
});

describe('sesión del equipo que se da a cambio del pase', () => {
  const secreto = 'x'.repeat(40);
  const usuario = { email: 'ana@ejemplo.test', nombre: 'Ana' };

  it('se firma, se lee igual y dura 12 horas', () => {
    let t = 5_000_000;
    const f = crearFirmador(secreto, () => t);
    const sesion = f.firmar('equipo', usuario, TTL_SESION_EQUIPO_MS);
    expect(f.leer('equipo', sesion)).toMatchObject(usuario);
    t += TTL_SESION_EQUIPO_MS - 1;
    expect(f.leer('equipo', sesion)).not.toBeNull();
    t += 2;
    expect(f.leer('equipo', sesion)).toBeNull();
  });

  it('no se confunde con el pase del participante, el boleto del canal ni la grabadora (y al revés)', () => {
    const f = crearFirmador(secreto);
    const sesion = f.firmar('equipo', usuario, 1000);
    for (const tipo of ['pase', 'boleto', 'grabadora']) {
      expect(f.leer(tipo, sesion)).toBeNull();
      expect(f.leer('equipo', f.firmar(tipo, { sid: 's1', pid: 'p1', ...usuario }, 1000))).toBeNull();
    }
  });

  it('con otro secreto o alterada no sirve', () => {
    const sesion = crearFirmador(secreto).firmar('equipo', usuario, 1000);
    expect(crearFirmador('y'.repeat(40)).leer('equipo', sesion)).toBeNull();
    const [cuerpo, firma] = sesion.split('.');
    const otro = Buffer.from(JSON.stringify({ ...usuario, email: 'jefa@ejemplo.test', t: 'equipo', exp: Date.now() + 1e9 })).toString('base64url');
    expect(crearFirmador(secreto).leer('equipo', `${otro}.${firma}`)).toBeNull();
    expect(crearFirmador(secreto).leer('equipo', `${cuerpo}.${firma}x`)).toBeNull();
  });

  it('un token de Supabase (tres partes) nunca se lee como sesión firmada', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.firma-de-mentira';
    expect(crearFirmador(secreto).leer('equipo', jwt)).toBeNull();
  });
});
