// Ensayo del login del equipo SIN tocar el Supabase real ni mandar correos: levanta un Supabase de mentira
// (/auth/v1/otp, /auth/v1/verify, /auth/v1/user) y un servidor de Talks en modo `supabase` apuntando a él,
// con la interfaz ya compilada (npm run build). Prueba en un Chrome de verdad: pedir enlace, entrar con el enlace,
// ver «Este correo no tiene acceso», correo desconocido, salir, y que el canal en vivo abra con boleto. También el acceso directo desde
// el Hub (pase de un solo uso, sin correo).
// Datos inventados (@ejemplo.test). Uso: npm run ensayo-login
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { crearFirmador } from '../server/acceso';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RAIZ = process.cwd();
const PUERTO_FALSO = 54399;
const PUERTO_TALKS = 8795;
const WEB = `http://localhost:${PUERTO_TALKS}`;
const SUPABASE = `http://localhost:${PUERTO_FALSO}`;

const LLAVE_DEL_HUB = 'llave-del-hub-de-prueba'; // inventada
const SECRETO_DE_PRUEBA = 'secreto-de-prueba-'.padEnd(48, 'x'); // inventado: el servidor del ensayo firma con este, y así la prueba puede firmar igual
const DEL_EQUIPO = 'moderadora@ejemplo.test';
const SIN_PERMISO = 'visita@ejemplo.test'; // existe en «Supabase» pero no está en EQUIPO_PERMITIDO
const DESCONOCIDO = 'nadie@ejemplo.test'; // no existe en «Supabase»

// ---------- Supabase de mentira ----------
const usuarios = new Set([DEL_EQUIPO, SIN_PERMISO]);
const tokens = new Map<string, string>(); // token -> correo
const enlacesPedidos: { email: string; createUser: unknown }[] = [];
const consultasUsuario: string[] = [];
let n = 0;

const falso = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', SUPABASE);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const cuerpo: Buffer[] = [];
  req.on('data', (c) => cuerpo.push(c));
  req.on('end', () => {
    const json = (estado: number, obj: unknown) => { res.writeHead(estado, { 'content-type': 'application/json' }).end(JSON.stringify(obj)); };
    if (url.pathname === '/auth/v1/otp' && req.method === 'POST') {
      const b = JSON.parse(Buffer.concat(cuerpo).toString() || '{}') as { email?: string; create_user?: boolean };
      const email = (b.email ?? '').toLowerCase();
      enlacesPedidos.push({ email, createUser: b.create_user });
      if (!usuarios.has(email) && b.create_user === false) { json(422, { code: 'otp_disabled', msg: 'Signups not allowed for otp' }); return; }
      json(200, {});
      return;
    }
    if (url.pathname === '/auth/v1/verify') { // el «enlace del correo»: redirige con la sesión en la dirección
      const email = (url.searchParams.get('email') ?? '').toLowerCase();
      const token = `tok_${++n}_${email}`;
      tokens.set(token, email);
      const destino = `${url.searchParams.get('redirect_to')}#access_token=${encodeURIComponent(token)}&token_type=bearer&expires_in=3600&refresh_token=r_${n}&type=magiclink`;
      res.writeHead(302, { location: destino }).end();
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      consultasUsuario.push(t);
      const email = tokens.get(t);
      if (!email) { json(401, { msg: 'invalid JWT' }); return; }
      json(200, { id: `u_${email}`, email, email_confirmed_at: '2026-11-01T00:00:00Z', user_metadata: { name: 'Persona de prueba' } });
      return;
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204).end(); return; }
    json(404, { msg: 'no existe en el servidor de mentira' });
  });
});

// ---------- Servidor de Talks en modo supabase ----------
const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'talks-ensayo-'));
fs.symlinkSync(path.join(RAIZ, 'dist'), path.join(trabajo, 'dist')); // datos/ queda en la carpeta temporal: no ensucia el guardado real

const resultados: { prueba: string; ok: boolean; detalle: string }[] = [];
const anotar = (prueba: string, ok: boolean, detalle = '') => { resultados.push({ prueba, ok, detalle }); console.log(`${ok ? 'OK ' : 'FALLÓ'}  ${prueba}${detalle ? ' — ' + detalle : ''}`); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cuerpoDe = (p: Page) => p.evaluate(() => document.body.innerText);

async function esperarTexto(p: Page, texto: string, ms = 8000): Promise<boolean> {
  try { await p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms, polling: 50 }, texto); return true; } catch { return false; }
}

async function main() {
  if (!fs.existsSync(path.join(RAIZ, 'dist/index.html'))) throw new Error('Falta la compilación: corre npm run build');
  await new Promise<void>((ok) => falso.listen(PUERTO_FALSO, ok));

  const entorno = { ...process.env, PORT: String(PUERTO_TALKS), AUTH_MODE: 'supabase', NODE_ENV: 'development', URL_PUBLICA: WEB,
    SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: 'llave-anon-de-mentira', EQUIPO_PERMITIDO: DEL_EQUIPO, HUB_API_KEY: LLAVE_DEL_HUB, APP_SECRET: SECRETO_DE_PRUEBA };
  const tsx = path.join(RAIZ, 'node_modules/.bin/tsx');
  const hijo = spawn(tsx, ['--env-file', path.join(RAIZ, '.env'), path.join(RAIZ, 'server/index.ts')], { cwd: trabajo, env: entorno, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  const apagar = async () => { hijo.kill('SIGTERM'); falso.close(); await dormir(200); };

  try {
    for (let i = 0; i < 60; i++) { if ((await fetch(`${WEB}/api/salud`).catch(() => null))?.ok) break; if (i === 59) throw new Error('El servidor del ensayo no arrancó:\n' + salida); await dormir(250); }

    const cfg = await (await fetch(`${WEB}/api/config-publica`)).json() as { authMode: string };
    anotar('El servidor arranca en modo supabase', cfg.authMode === 'supabase');

    // Sin sesión, las rutas del equipo están cerradas
    const sinSesion = await fetch(`${WEB}/api/equipo/yo`);
    anotar('Sin sesión, /api/equipo/yo responde 401', sinSesion.status === 401, `estado ${sinSesion.status}`);
    const conMentira = await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: 'Bearer inventado', 'x-equipo-email': DEL_EQUIPO } });
    anotar('Un token inventado (aunque mande x-equipo-email) no pasa', conMentira.status === 401, `estado ${conMentira.status}`);

    // La puerta del Hub: crear una sesión por API pide la llave del Hub (o ser del equipo con sesión).
    const cuerpo = JSON.stringify({ nombre: 'Prueba', externoId: 'evento-1' });
    const POST = (autorizacion?: string) => fetch(`${WEB}/api/v1/sesiones`, { method: 'POST', headers: { 'content-type': 'application/json', ...(autorizacion ? { authorization: autorizacion } : {}) }, body: cuerpo });
    anotar('Crear una sesión por API sin credenciales da 401', (await POST()).status === 401);
    anotar('Con una llave equivocada da 401', (await POST('Bearer llave-equivocada')).status === 401);
    const conLlave = await POST(`Bearer ${LLAVE_DEL_HUB}`);
    anotar('Con la llave del Hub se crea (201) y trae los links', conLlave.status === 201 && !!(await conLlave.json()).linkParticipantes, `estado ${conLlave.status}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-login-'));
    const nav = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ['--no-first-run', '--no-default-browser-check'] });
    try {
      const p = await nav.newPage();
      const errores: string[] = [];
      p.on('pageerror', (e) => errores.push(String(e)));
      const sockets: string[] = [];
      p.on('request', (r) => { if (r.url().startsWith('ws')) sockets.push(r.url()); });
      const cdp = await p.createCDPSession();
      await cdp.send('Network.enable');
      cdp.on('Network.webSocketCreated', (e) => sockets.push(e.url));

      // 1. Correo desconocido: no se crea cuenta nueva
      await p.goto(WEB, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 });
      anotar('Sin sesión, la pantalla pide el correo', true);
      await p.type('[data-testid="entrar-correo"]', DESCONOCIDO);
      await p.click('[data-testid="entrar-enviar"]');
      anotar('Un correo desconocido dice «Ese correo no tiene acceso»', await esperarTexto(p, 'Ese correo no tiene acceso'));
      anotar('El pedido de enlace manda create_user=false (no crea cuentas)', enlacesPedidos.at(-1)?.createUser === false, JSON.stringify(enlacesPedidos.at(-1)));

      // 2. Persona con cuenta pero fuera de la lista: entra a Supabase, el servidor la rechaza
      await p.$eval('[data-testid="entrar-correo"]', (el) => { (el as HTMLInputElement).value = ''; });
      await p.focus('[data-testid="entrar-correo"]');
      await p.type('[data-testid="entrar-correo"]', SIN_PERMISO);
      await p.click('[data-testid="entrar-enviar"]');
      anotar('Pedir el enlace muestra «Revisa tu correo»', await esperarTexto(p, 'Revisa tu correo'));
      await p.goto(`${SUPABASE}/auth/v1/verify?email=${SIN_PERMISO}&redirect_to=${encodeURIComponent(WEB + '/')}`, { waitUntil: 'domcontentloaded' });
      anotar('Con cuenta pero sin permiso: «Este correo no tiene acceso»', await esperarTexto(p, 'Este correo no tiene acceso'));
      anotar('No se muestra la pantalla de inicio al que no tiene permiso', !(await cuerpoDe(p)).includes('Nombre de la sesión') && (await p.$('[data-testid="nueva-sesion"]')) === null);
      await p.click('[data-testid="sin-acceso"] button');
      anotar('«Usar otro correo» regresa a pedir el correo', await p.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));

      // 3. El equipo entra con su enlace
      await p.type('[data-testid="entrar-correo"]', DEL_EQUIPO);
      await p.click('[data-testid="entrar-enviar"]');
      anotar('Se pide el enlace del correo del equipo', await esperarTexto(p, 'Revisa tu correo') && enlacesPedidos.at(-1)?.email === DEL_EQUIPO);
      await p.goto(`${SUPABASE}/auth/v1/verify?email=${DEL_EQUIPO}&redirect_to=${encodeURIComponent(WEB + '/')}`, { waitUntil: 'domcontentloaded' });
      anotar('Con el enlace, el equipo entra al inicio', await p.waitForSelector('[data-testid="nueva-sesion"]', { timeout: 8000 }).then(() => true, () => false));
      anotar('La dirección ya no trae el token', !p.url().includes('access_token'), p.url());

      // 4. Crear una sesión y abrir la consola: el canal en vivo con boleto
      await p.type('[data-testid="nueva-sesion"]', 'Ensayo de login');
      await p.click('[data-testid="crear"]');
      await p.waitForSelector('a[href^="/equipo/"]', { timeout: 8000 });
      await p.click('a[href^="/equipo/"]');
      anotar('Crea una sesión y abre la consola', await p.waitForSelector('[data-testid="consola"]', { timeout: 10000 }).then(() => true, () => false), p.url());
      await dormir(1500);
      const canal = sockets.find((u) => u.includes('/ws?'));
      anotar('El canal en vivo abre con boleto', !!canal && canal.includes('boleto=') && !canal.includes('access_token') && !canal.includes('tok_'), canal ? canal.replace(/boleto=[^&]+/, 'boleto=…') : 'sin canal');
      anotar('La consola está abierta (el equipo pasó la verificación)', await p.$eval('[data-testid="consola"]', (el) => !!el).catch(() => false));

      // 5. Volver a la pestaña (Supabase repite SIGNED_IN): la pantalla NO se tapa
      await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await dormir(1200);
      anotar('Volver a la pestaña no tapa la consola', (await p.$('[data-testid="consola"]')) !== null);

      // 6. Recargar conserva la sesión
      await p.reload({ waitUntil: 'domcontentloaded' });
      anotar('Al recargar sigue adentro (sesión guardada)', await p.waitForSelector('[data-testid="consola"]', { timeout: 10000 }).then(() => true, () => false));

      // 7. Reglas del servidor con tokens sueltos
      const r403 = await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${(() => { const t = 'tok_x_' + SIN_PERMISO; tokens.set(t, SIN_PERMISO); return t; })()}` } });
      anotar('Una sesión válida de alguien fuera de la lista da 403', r403.status === 403, `estado ${r403.status}`);
      const rBoleto = await fetch(`${WEB}/api/sesiones/inexistente/equipo/boleto`, { method: 'POST' });
      anotar('Pedir boleto sin sesión da 401', rBoleto.status === 401, `estado ${rBoleto.status}`);

      // 8. Una sesión guardada que Supabase ya no reconoce: la pantalla regresa a pedir el correo, con aviso
      await p.evaluate(() => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) {
          const v = JSON.parse(localStorage.getItem(k) ?? '{}'); v.access_token = 'tok_que_ya_no_existe'; localStorage.setItem(k, JSON.stringify(v));
        }
      });
      await p.goto(WEB, { waitUntil: 'domcontentloaded' });
      anotar('Con una sesión vencida, la pantalla regresa a pedir el correo', await p.waitForSelector('[data-testid="entrar-correo"]', { timeout: 10000 }).then(() => true, () => false));
      anotar('…y avisa que la sesión venció', await esperarTexto(p, 'venció'));

      // vuelve a entrar y sale con el botón
      await p.type('[data-testid="entrar-correo"]', DEL_EQUIPO);
      await p.click('[data-testid="entrar-enviar"]');
      await esperarTexto(p, 'Revisa tu correo');
      await p.goto(`${SUPABASE}/auth/v1/verify?email=${DEL_EQUIPO}&redirect_to=${encodeURIComponent(WEB + '/')}`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('[data-testid="salir"]', { timeout: 8000 });
      await p.click('[data-testid="salir"]');
      anotar('«Salir» regresa a pedir el correo', await p.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));

      // 10. Acceso directo desde el Hub: un pase de un solo uso, sin pedir correo
      // null = sin encabezado de autorización (con undefined, JavaScript usaría la llave por defecto)
      const pase = (cuerpo: object, autorizacion: string | null = `Bearer ${LLAVE_DEL_HUB}`) => fetch(`${WEB}/api/v1/acceso-equipo`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(autorizacion ? { authorization: autorizacion } : {}) }, body: JSON.stringify(cuerpo),
      });
      const canjear = (codigo: string) => fetch(`${WEB}/api/equipo/canjear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo }) });
      const sesionHub = await (await fetch(`${WEB}/api/v1/sesiones`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LLAVE_DEL_HUB}` }, body: JSON.stringify({ nombre: 'Sesión del Hub', externoId: 'evento-hub-1' }),
      })).json() as { id: string };

      anotar('Pedir un pase sin llave da 401', (await pase({ email: DEL_EQUIPO }, null)).status === 401);
      anotar('Pedir un pase con una llave equivocada da 401', (await pase({ email: DEL_EQUIPO }, 'Bearer llave-equivocada')).status === 401);
      const tokenPersona = `tok_pase_${DEL_EQUIPO}`; tokens.set(tokenPersona, DEL_EQUIPO);
      anotar('Una persona del equipo con su sesión NO puede pedirse un pase (solo el Hub con su llave)', (await pase({ email: DEL_EQUIPO }, `Bearer ${tokenPersona}`)).status === 401);
      anotar('Un correo fuera de la lista da 403', (await pase({ email: SIN_PERMISO })).status === 403);
      anotar('Un correo mal escrito da 400', (await pase({ email: 'no-es-correo' })).status === 400);
      anotar('Una sesión que no existe da 404', (await pase({ email: DEL_EQUIPO, sesionId: 'no-existe' })).status === 404);
      anotar('«constructor» no existe como sesión (404), aunque sea una palabra de JavaScript', (await pase({ email: DEL_EQUIPO, sesionId: 'constructor' })).status === 404);
      anotar('Un id de sesión con caracteres raros da 400', (await pase({ email: DEL_EQUIPO, sesionId: '../x' })).status === 400);
      anotar('El correo se compara sin importar mayúsculas', (await pase({ email: DEL_EQUIPO.toUpperCase() })).status === 201);

      const rPase = await pase({ email: DEL_EQUIPO, sesionId: sesionHub.id });
      const jPase = await rPase.json() as { url: string; venceEnSegundos: number };
      anotar('Con la llave del Hub y un correo del equipo da el pase (201), que vale 60 segundos', rPase.status === 201 && jPase.venceEnSegundos === 60, `estado ${rPase.status}`);
      anotar('El pase va en la parte «#» de la dirección, no en la consulta (así no llega a los registros)', jPase.url.startsWith(`${WEB}/entrar-hub#c=`) && !jPase.url.includes('?'));

      const paseApi = ((await (await pase({ email: DEL_EQUIPO })).json()) as { url: string }).url.split('#c=')[1] ?? '';
      const c1 = await canjear(paseApi);
      const j1 = await c1.json() as { token: string; email: string; destino: string; venceEn: number };
      anotar('Canjear el pase da una sesión del equipo y a dónde ir', c1.status === 200 && !!j1.token && j1.email === DEL_EQUIPO && j1.destino === '/', `estado ${c1.status}`);
      anotar('La sesión dura unas 12 horas', j1.venceEn - Date.now() > 11.9 * 3600e3 && j1.venceEn - Date.now() <= 12 * 3600e3);
      anotar('El mismo pase no sirve una segunda vez (401)', (await canjear(paseApi)).status === 401);
      anotar('Un pase inventado da 401', (await canjear('pase-inventado-que-no-existe-1234567890')).status === 401);
      const yoHub = await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${j1.token}` } });
      anotar('La sesión que da el Hub abre las rutas del equipo', yoHub.status === 200 && ((await yoHub.json()) as { email: string }).email === DEL_EQUIPO);
      anotar('…y se comprueba en Talks mismo, sin preguntarle a Supabase', !consultasUsuario.includes(j1.token));
      const alterado = j1.token.slice(0, -3) + (j1.token.endsWith('aaa') ? 'bbb' : 'aaa');
      anotar('Una sesión alterada no pasa (401)', (await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${alterado}` } })).status === 401);
      anotar('Esa sesión también abre el boleto del canal en vivo', (await fetch(`${WEB}/api/sesiones/${sesionHub.id}/equipo/boleto`, { method: 'POST', headers: { authorization: `Bearer ${j1.token}` } })).status === 200);

      // La lista manda siempre: una sesión BIEN FIRMADA de alguien que ya no está en EQUIPO_PERMITIDO no pasa (403)
      const firmaPrueba = crearFirmador(SECRETO_DE_PRUEBA);
      const deAlguienFuera = firmaPrueba.firmar('equipo', { email: SIN_PERMISO, nombre: 'Visita' }, 3600e3);
      anotar('Una sesión del Hub bien firmada de alguien fuera de la lista da 403', (await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${deAlguienFuera}` } })).status === 403);
      const deAlguienDentro = firmaPrueba.firmar('equipo', { email: DEL_EQUIPO, nombre: 'Marina' }, 3600e3);
      anotar('…y la misma firma para alguien de la lista sí pasa (la prueba firma igual que el servidor)', (await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${deAlguienDentro}` } })).status === 200);
      const vencida = crearFirmador(SECRETO_DE_PRUEBA, () => Date.now() - 2 * 3600e3).firmar('equipo', { email: DEL_EQUIPO, nombre: 'Marina' }, 3600e3);
      anotar('Una sesión del Hub vencida da 401', (await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${vencida}` } })).status === 401);
      const comoPase = firmaPrueba.firmar('pase', { sid: 's1', pid: 'p1', email: DEL_EQUIPO, nombre: 'Marina' }, 3600e3);
      anotar('Un pase de participante NO abre las rutas del equipo', (await fetch(`${WEB}/api/equipo/yo`, { headers: { authorization: `Bearer ${comoPase}` } })).status === 401);

      // En un Chrome limpio (sin ninguna sesión): el enlace del Hub abre directo la consola de esa sesión
      const ctx = await nav.createBrowserContext();
      const h = await ctx.newPage();
      const erroresH: string[] = [];
      h.on('pageerror', (e) => erroresH.push(String(e)));
      const socketsH: string[] = [];
      const cdpH = await h.createCDPSession();
      await cdpH.send('Network.enable');
      cdpH.on('Network.webSocketCreated', (e) => socketsH.push(e.url));
      const correosAntes = enlacesPedidos.length;
      const dirPase = ((await (await pase({ email: DEL_EQUIPO, sesionId: sesionHub.id })).json()) as { url: string }).url;
      await h.goto(dirPase, { waitUntil: 'domcontentloaded' });
      anotar('Con el enlace del Hub se abre la consola de esa sesión, sin pedir correo', await h.waitForSelector('[data-testid="consola"]', { timeout: 10000 }).then(() => true, () => false), h.url());
      anotar('La dirección ya no trae el pase y quedó en la consola', !h.url().includes('#c=') && h.url() === `${WEB}/equipo/${sesionHub.id}`, h.url());
      anotar('No se pidió ningún correo de acceso', enlacesPedidos.length === correosAntes);
      await dormir(1200);
      const guardado = await h.evaluate(() => localStorage.getItem('talks:acceso-hub'));
      const tokenGuardado = guardado ? (JSON.parse(guardado) as { token: string }).token : '';
      const canalH = socketsH.find((u) => u.includes('/ws?'));
      anotar('El canal en vivo abre con boleto, sin la sesión ni el pase en la dirección', !!canalH && canalH.includes('boleto=') && !!tokenGuardado && !canalH.includes(tokenGuardado) && !canalH.includes(dirPase.split('#c=')[1] ?? 'x'), canalH ? canalH.replace(/boleto=[^&]+/, 'boleto=…') : 'sin canal');
      await h.reload({ waitUntil: 'domcontentloaded' });
      anotar('Al recargar sigue adentro (la sesión del Hub se guardó)', await h.waitForSelector('[data-testid="consola"]', { timeout: 10000 }).then(() => true, () => false));

      // El mismo enlace en otro Chrome limpio: ya se gastó
      const ctx2 = await nav.createBrowserContext();
      const h2 = await ctx2.newPage();
      await h2.goto(dirPase, { waitUntil: 'domcontentloaded' });
      anotar('El mismo enlace del Hub no sirve dos veces: lo dice con claridad', await h2.waitForSelector('[data-testid="entrar-hub-error"]', { timeout: 10000 }).then(() => true, () => false));
      anotar('…y no deja pasar a la consola', (await h2.$('[data-testid="consola"]')) === null);
      await h2.click('[data-testid="entrar-hub-error"] button');
      anotar('«Entrar con mi correo» lleva al acceso normal', await h2.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));
      await h2.goto(`${WEB}/entrar-hub`, { waitUntil: 'domcontentloaded' });
      anotar('Abrir /entrar-hub sin pase avisa que no sirve', await h2.waitForSelector('[data-testid="entrar-hub-error"]', { timeout: 8000 }).then(() => true, () => false));
      await ctx2.close();

      // Salir con la sesión del Hub
      await h.goto(WEB, { waitUntil: 'domcontentloaded' });
      await h.waitForSelector('[data-testid="salir"]', { timeout: 8000 });
      await h.click('[data-testid="salir"]');
      anotar('«Salir» con la sesión del Hub regresa a pedir el correo', await h.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));
      anotar('…y borra la sesión guardada', (await h.evaluate(() => localStorage.getItem('talks:acceso-hub'))) === null);
      await h.reload({ waitUntil: 'domcontentloaded' });
      anotar('Recargar después de salir sigue pidiendo el correo', await h.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));

      // Una sesión del Hub vencida o que el servidor no reconoce: se pide el correo, con aviso
      await h.evaluate(() => localStorage.setItem('talks:acceso-hub', JSON.stringify({ token: 'x.y', email: 'moderadora@ejemplo.test', nombre: 'M', venceEn: Date.now() - 1000 })));
      await h.reload({ waitUntil: 'domcontentloaded' });
      anotar('Una sesión del Hub vencida se ignora y se pide el correo', await h.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false));
      await h.evaluate(() => localStorage.setItem('talks:acceso-hub', JSON.stringify({ token: 'inventada.inventada', email: 'moderadora@ejemplo.test', nombre: 'M', venceEn: Date.now() + 3600e3 })));
      await h.reload({ waitUntil: 'domcontentloaded' });
      anotar('Una sesión del Hub falsa no deja pasar: pide el correo y avisa', await h.waitForSelector('[data-testid="entrar-correo"]', { timeout: 8000 }).then(() => true, () => false) && await esperarTexto(h, 'venció'));
      anotar('Sin errores de JavaScript en el acceso desde el Hub', erroresH.length === 0, erroresH.join(' | '));
      await ctx.close();

      // 9. Los participantes nunca descargan Supabase ni piden login
      const part = await nav.newPage();
      const pedidos: string[] = [];
      part.on('request', (r) => pedidos.push(r.url()));
      await part.goto(`${WEB}/p/inexistente`, { waitUntil: 'networkidle0' });
      anotar('La página de participantes no pide login', (await cuerpoDe(part)).includes('Entrar') === false && (await part.$('[data-testid="entrar-correo"]')) === null);
      anotar('La página de participantes no habla con Supabase', !pedidos.some((u) => u.startsWith(SUPABASE)), pedidos.filter((u) => u.startsWith(SUPABASE)).join(', '));

      anotar('Sin errores de JavaScript en la pantalla', errores.length === 0, errores.join(' | '));
    } finally { await nav.close(); }
  } finally { await apagar(); fs.rmSync(trabajo, { recursive: true, force: true }); }

  const malas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - malas.length}/${resultados.length} pruebas bien`);
  process.exit(malas.length ? 1 : 0);
}

main().catch((e) => { console.error('El ensayo se cortó:', e instanceof Error ? e.message : e); process.exit(1); });
