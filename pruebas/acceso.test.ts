import { describe, expect, it, vi } from 'vitest';
import { crearFirmador, crearVerificadorEquipo, ErrorAcceso, leerLista, nombreDeCorreo, type UsuarioSupabase } from '../server/acceso';

const confirmado = (email: string, extra: Partial<UsuarioSupabase> = {}): UsuarioSupabase => ({ email, email_confirmed_at: '2026-11-01T00:00:00Z', ...extra });

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try { await promesa; return 'OK'; } catch (e) { return e instanceof ErrorAcceso ? `${e.estado} ${e.codigo}` : `otro: ${String(e)}`; }
}

describe('firmas (pase del participante y boleto del equipo)', () => {
  const secreto = 'x'.repeat(40);

  it('lo firmado se lee igual', () => {
    const f = crearFirmador(secreto);
    const pase = f.firmar('pase', { sid: 's1', pid: 'p1' }, 1000);
    expect(f.leer<{ sid: string; pid: string }>('pase', pase)).toMatchObject({ sid: 's1', pid: 'p1' });
  });

  it('un pase no sirve como boleto ni al revés', () => {
    const f = crearFirmador(secreto);
    const pase = f.firmar('pase', { sid: 's1', pid: 'p1' }, 1000);
    const boleto = f.firmar('boleto', { sid: 's1', email: 'a@b.c', nombre: 'A' }, 1000);
    expect(f.leer('boleto', pase)).toBeNull();
    expect(f.leer('pase', boleto)).toBeNull();
  });

  it('vence', () => {
    let ahora = 1_000_000;
    const f = crearFirmador(secreto, () => ahora);
    const boleto = f.firmar('boleto', { sid: 's1' }, 60_000);
    ahora += 59_000;
    expect(f.leer('boleto', boleto)).not.toBeNull();
    ahora += 2_000;
    expect(f.leer('boleto', boleto)).toBeNull();
  });

  it('rechaza lo alterado, lo de otro secreto y la basura', () => {
    const f = crearFirmador(secreto);
    const otro = crearFirmador('y'.repeat(40));
    const boleto = f.firmar('boleto', { sid: 's1', email: 'a@b.c' }, 1000);
    const [cuerpo, firma] = boleto.split('.');
    const alterado = Buffer.from(JSON.stringify({ sid: 's2', email: 'a@b.c', t: 'boleto', exp: Date.now() + 99999 })).toString('base64url');
    expect(f.leer('boleto', `${alterado}.${firma}`)).toBeNull();
    expect(otro.leer('boleto', boleto)).toBeNull();
    for (const basura of ['', 'x', 'a.b', 'a.b.c', `${cuerpo}.`, null, undefined]) expect(f.leer('boleto', basura as string)).toBeNull();
  });
});

describe('lista de correos y nombre', () => {
  it('separa por coma, espacio o salto de línea, sin repetir y en minúsculas', () => {
    expect(leerLista('Ana@x.com, bob@x.com;\n  ANA@x.com  carla@x.com')).toEqual(['ana@x.com', 'bob@x.com', 'carla@x.com']);
    expect(leerLista('  ')).toEqual([]);
  });

  it('arma el nombre con el correo si la cuenta no lo trae', () => {
    expect(nombreDeCorreo('ana.lopez@x.com')).toBe('Ana Lopez');
    expect(nombreDeCorreo('sergio@x.com')).toBe('Sergio');
    expect(nombreDeCorreo('a@x.com', { full_name: '  Ana López  ' })).toBe('Ana López');
    expect(nombreDeCorreo('a@x.com', { name: 42 })).toBe('A');
  });
});

describe('verificación del equipo con Supabase', () => {
  it('sin token: 401', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => confirmado('a@x.com'), permitidos: ['a@x.com'] });
    expect(await codigoDe(verificar(undefined))).toBe('401 NO_AUTENTICADO');
    expect(await codigoDe(verificar(''))).toBe('401 NO_AUTENTICADO');
  });

  it('correo autorizado entra, sin importar mayúsculas', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => confirmado('  Ana@X.com '), permitidos: ['ANA@x.com'] });
    expect(await verificar('t1')).toEqual({ email: 'ana@x.com', nombre: 'Ana' });
  });

  it('correo con sesión válida pero fuera de la lista: 403', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => confirmado('intruso@x.com'), permitidos: ['ana@x.com'] });
    expect(await codigoDe(verificar('t1'))).toBe('403 SIN_ACCESO');
  });

  it('token inválido o vencido: 401', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => null, permitidos: ['ana@x.com'] });
    expect(await codigoDe(verificar('malo'))).toBe('401 NO_AUTENTICADO');
  });

  it('correo sin confirmar: 401, aunque esté en la lista', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => ({ email: 'ana@x.com' }), permitidos: ['ana@x.com'] });
    expect(await codigoDe(verificar('t1'))).toBe('401 NO_AUTENTICADO');
  });

  it('si Supabase no contesta: 503 (no se confunde con «no tienes acceso»)', async () => {
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => { throw new Error('red caída'); }, permitidos: ['ana@x.com'] });
    expect(await codigoDe(verificar('t1'))).toBe('503 SIN_VERIFICAR');
  });

  it('recuerda 60 s por token y después vuelve a preguntar', async () => {
    let ahora = 0;
    const obtener = vi.fn(async () => confirmado('ana@x.com'));
    const verificar = crearVerificadorEquipo({ obtenerUsuario: obtener, permitidos: ['ana@x.com'], ahora: () => ahora });
    await verificar('t1'); await verificar('t1');
    expect(obtener).toHaveBeenCalledTimes(1);
    await verificar('t2'); // otro token: pregunta aparte
    expect(obtener).toHaveBeenCalledTimes(2);
    ahora = 61_000;
    await verificar('t1');
    expect(obtener).toHaveBeenCalledTimes(3);
  });

  it('un rechazo no se queda guardado: al corregir el acceso entra', async () => {
    let usuario: UsuarioSupabase | null = null;
    const verificar = crearVerificadorEquipo({ obtenerUsuario: async () => usuario, permitidos: ['ana@x.com'] });
    expect(await codigoDe(verificar('t1'))).toBe('401 NO_AUTENTICADO');
    usuario = confirmado('ana@x.com');
    expect(await codigoDe(verificar('t1'))).toBe('OK');
  });
});
