// Prueba de punta a punta de la PANTALLA COMPARTIDA del equipo (presentaciones, PDFs, videos con sonido): Chrome sin ventana, pantalla y cámara sintéticas.
// Dos personas del equipo (Marina modera, Pablo produce), tres participantes (Ana en el escenario, Beto en backstage, Dora en el lobby) y la página que se transmite.
// Revisa sobre todo la PRIVACIDAD (a nivel de red): en backstage la pantalla solo la recibe el equipo, y solo cuando se sube al escenario la reciben los de adentro.
// Requiere el servidor (npm run dev:servidor) y la interfaz (npm run dev:web) encendidos. Uso: npm run e2e:pantalla
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { mediosFalsos } from './medios-falsos';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const API = 'http://localhost:8787/api';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MARINA = { email: 'moderadora@ejemplo.test', nombre: 'Marina' };
const PABLO = { email: 'produccion@ejemplo.test', nombre: 'Pablo' };
const CAPTURAS = process.env.CAPTURAS;
const foto = async (pag: Page, nombre: string) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await pag.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) }); } };

const resultados: { prueba: string; ok: boolean }[] = [];
const anotar = (prueba: string, ok: boolean, detalle = '') => { resultados.push({ prueba, ok }); console.log(`${ok ? 'OK ' : 'FALLÓ'}  ${prueba}${detalle ? ` — ${detalle}` : ''}`); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esperar(pagina: Page, fn: string, ms = 15000) {
  try { await pagina.waitForFunction(fn, { polling: 50, timeout: ms }); } catch {
    const texto = await pagina.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '(sin texto)');
    throw new Error(`Se agotó la espera de «${fn.slice(0, 120)}» en ${pagina.url()}. La pantalla decía: ${texto.replace(/\n+/g, ' | ')}`);
  }
}
/** true si se cumple antes del plazo, false si no (para comprobar que algo NO pasa o que deja de pasar). */
const llega = (pagina: Page, fn: string, ms: number) => pagina.waitForFunction(fn, { polling: 50, timeout: ms }).then(() => true, () => false);

const lugar = (n: string) => `document.querySelector('[data-testid="dentro"]')?.getAttribute('data-lugar') === ${JSON.stringify(n)}`;
const hay = (sel: string) => `!!document.querySelector(${JSON.stringify(sel)})`;
const noHay = (sel: string) => `!document.querySelector(${JSON.stringify(sel)})`;
const clic = (pagina: Page, testid: string) => pagina.$eval(`[data-testid="${testid}"]`, (el) => (el as HTMLElement).click());
const textoDe = (pagina: Page, testid: string) => pagina.evaluate((id: string) => (document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '', testid);
/** La pantalla compartida con video de verdad dentro de ese contenedor. */
const pantallaViva = (contenedor: string) => `(() => { const v = document.querySelector('${contenedor} [data-testid="mosaico-Pantalla"] video'); return !!v && v.videoWidth > 0 && v.readyState >= 2; })()`;
/** Qué pistas del EQUIPO (identidades «eq_…») está recibiendo de verdad esta pantalla: «camera», «microphone», «screen_share», «screen_share_audio». */
const fuentesDeEquipo = async (pag: Page): Promise<string[]> => JSON.parse(String(await pag.evaluate(`JSON.stringify((() => {
  const sala = window.__sala; const r = new Set();
  if (!sala) return [];
  for (const p of sala.remoteParticipants.values()) { if (!p.identity.startsWith('eq_')) continue; for (const t of p.trackPublications.values()) if (t.isSubscribed) r.add(t.source); }
  return [...r].sort(); })())`)));
const sinPantalla = (f: string[]) => !f.includes('screen_share') && !f.includes('screen_share_audio');

async function main() {
  const salud = await fetch('http://localhost:8787/api/salud').catch(() => null);
  if (!salud?.ok) throw new Error('El servidor no está encendido (npm run dev:servidor)');
  const cabDe = (u: { email: string; nombre: string }) => ({ 'content-type': 'application/json', 'x-equipo-email': u.email, 'x-equipo-nombre': u.nombre });
  const creada = await (await fetch(`${API}/v1/sesiones`, { method: 'POST', headers: cabDe(MARINA), body: JSON.stringify({ nombre: `Prueba pantalla ${new Date().toISOString().slice(11, 19)}` }) })).json() as { id: string; codigo: string };

  const lanzados: { cerrar: () => Promise<void> }[] = [];
  const nuevaPantalla = async (): Promise<Page> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-'));
    const nav = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'] });
    lanzados.push({ cerrar: async () => { await nav.close().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); } });
    const [pagina] = await nav.pages();
    return pagina ?? (await nav.newPage());
  };
  const equipo = async (u: { email: string; nombre: string }): Promise<Page> => {
    const p = await nuevaPantalla();
    await p.setViewport({ width: 1440, height: 900 });
    await p.evaluateOnNewDocument(mediosFalsos(640, 360));
    p.on('pageerror', (e) => console.log(`  [${u.nombre}] error:`, String(e).slice(0, 160)));
    await p.goto(`${WEB}/equipo/${creada.id}?email=${u.email}&nombre=${u.nombre}`);
    await esperar(p, hay('[data-testid="consola"]'));
    return p;
  };
  const participante = async (nombre: string): Promise<Page> => {
    const p = await nuevaPantalla();
    await p.setViewport({ width: 1280, height: 800 });
    await p.evaluateOnNewDocument(mediosFalsos(640, 360));
    p.on('pageerror', (e) => console.log(`  [${nombre}] error:`, String(e).slice(0, 160)));
    await p.goto(`${WEB}/p/${creada.codigo}`);
    await p.waitForSelector('[data-testid="acepto-aviso"]');
    for (let i = 0; i < 8; i++) { await p.click('[data-testid="acepto-aviso"]'); if (await p.$eval('[data-testid="acepto-aviso"]', (el) => (el as HTMLInputElement).checked)) break; await dormir(250); }
    await p.waitForFunction(`!document.querySelector('[data-testid="aceptar-aviso"]')?.disabled`, { polling: 50, timeout: 10000 });
    await p.click('[data-testid="aceptar-aviso"]');
    await p.waitForSelector('[data-testid="nombre"]');
    await p.type('[data-testid="nombre"]', nombre);
    await p.click('[data-testid="continuar"]');
    await esperar(p, `!!document.querySelector('[data-testid="todo-listo"]') && !document.querySelector('[data-testid="todo-listo"]').disabled`);
    await p.click('[data-testid="todo-listo"]');
    await esperar(p, lugar('lobby'));
    return p;
  };

  try {
    const marina = await equipo(MARINA);
    const pablo = await equipo(PABLO);
    anotar('Dos personas del equipo (moderadora y producción) abren la consola', true);
    const ana = await participante('Ana'); const beto = await participante('Beto'); const dora = await participante('Dora');
    for (const n of ['Ana', 'Beto', 'Dora']) await esperar(marina, hay(`[data-testid="fila-lobby-${n}"]`));
    await clic(marina, 'llamar-Ana'); await esperar(ana, lugar('verde')); await clic(marina, 'pasar-Ana'); await esperar(ana, lugar('backstage')); await clic(marina, 'subir-Ana'); await esperar(ana, lugar('escenario'));
    await clic(marina, 'llamar-Beto'); await esperar(beto, lugar('verde')); await clic(marina, 'pasar-Beto'); await esperar(beto, lugar('backstage'));
    await clic(marina, 'mi-escenario'); // la moderadora sube: su cámara y su micrófono llegan a todos
    await esperar(ana, `(() => { const v = document.querySelector('[data-testid="mosaico-Marina"] video'); return !!v && v.videoWidth > 0; })()`);
    await esperar(beto, `(() => { const v = document.querySelector('[data-testid="mosaico-Marina"] video'); return !!v && v.videoWidth > 0; })()`);
    anotar('Preparados: Marina y Ana en el escenario, Beto en backstage, Dora en el lobby', true);

    // La página que se transmite (la que abre LiveKit): se abre igual que la vista previa del equipo.
    const previa = await (await fetch(`${API}/sesiones/${creada.id}/grabadora/vista-previa`, { method: 'POST', headers: cabDe(MARINA) })).json() as { direccion: string };
    const gra = await nuevaPantalla();
    await gra.setViewport({ width: 1920, height: 1080 });
    await gra.evaluateOnNewDocument('window.__TRAZA = true;');
    await gra.goto(`${WEB}${previa.direccion}`);
    await esperar(gra, hay('[data-testid="grabadora"] [data-testid="mosaico-Marina"] video'), 25000);
    const audiosAntes = Number(await gra.evaluate(`document.querySelectorAll('audio').length`));

    // ── 1. Marina (en el escenario, con la cámara a la vista de todos) empieza a compartir un video con sonido ──
    await clic(marina, 'boton-pantalla');
    await esperar(marina, hay('[data-testid="elegir-pantalla"]'));
    anotar('«Compartir pantalla» pregunta qué se va a compartir (presentación o video)', !!(await marina.$('[data-testid="pantalla-presentacion"]')) && !!(await marina.$('[data-testid="pantalla-video"]')));
    await clic(marina, 'pantalla-video');
    await esperar(marina, hay('[data-testid="tarjeta-pantalla"]'), 20000);
    await esperar(marina, pantallaViva('[data-testid="tarjeta-pantalla"]'), 20000);
    await esperar(pablo, pantallaViva('[data-testid="tarjeta-pantalla"]'), 20000);
    const pedida = JSON.parse(String(await marina.evaluate('window.__pantallaPedida || "{}"'))) as { audio?: unknown };
    anotar('Un video pide el sonido al navegador', !!pedida.audio);
    anotar('Nace en BACKSTAGE: la moderadora y producción la ven ahí, con su sonido', (await textoDe(marina, 'tarjeta-pantalla')).includes('Con sonido') && (await textoDe(pablo, 'tarjeta-pantalla')).includes('Con sonido'));
    await foto(marina, 'p1-pantalla-en-backstage');

    // ── 2. PRIVACIDAD en backstage: nadie fuera del equipo la recibe (a nivel de red), pero la cámara y el micrófono de Marina siguen llegando ──
    await dormir(2500);
    const fAna = await fuentesDeEquipo(ana); const fBeto = await fuentesDeEquipo(beto); const fDora = await fuentesDeEquipo(dora); const fPablo = await fuentesDeEquipo(pablo);
    anotar('Ana (en el escenario) NO recibe la pantalla ni su sonido mientras está en backstage', sinPantalla(fAna), JSON.stringify(fAna));
    anotar('Beto (en backstage) NO recibe la pantalla ni su sonido', sinPantalla(fBeto), JSON.stringify(fBeto));
    anotar('Dora (en el lobby) no recibe nada', fDora.length === 0, JSON.stringify(fDora));
    anotar('Ana y Beto SIGUEN recibiendo la cámara y el micrófono de Marina (proteger la pantalla no los afecta)', fAna.includes('camera') && fAna.includes('microphone') && fBeto.includes('camera') && fBeto.includes('microphone'), `${JSON.stringify(fAna)} ${JSON.stringify(fBeto)}`);
    anotar('Producción (equipo) SÍ recibe la pantalla y su sonido', fPablo.includes('screen_share') && fPablo.includes('screen_share_audio'), JSON.stringify(fPablo));
    anotar('En la pantalla de los participantes no hay ni rastro de la pantalla compartida', (await ana.$('[data-testid="mosaico-Pantalla"]')) === null && (await beto.$('[data-testid="mosaico-Pantalla"]')) === null && (await dora.$('[data-testid="mosaico-Pantalla"]')) === null);
    anotar('La página que se transmite tampoco la muestra ni la escucha', (await gra.$('[data-testid="mosaico-Pantalla"]')) === null && Number(await gra.evaluate(`document.querySelectorAll('audio').length`)) === audiosAntes);

    // ── 3. Producción la sube al escenario (cualquiera del equipo puede) ──
    await clic(pablo, 'subir-pantalla');
    await esperar(ana, pantallaViva('[data-testid="escenario"]'), 20000);
    await esperar(beto, pantallaViva('[data-testid="escenario"]'), 20000);
    await esperar(marina, pantallaViva('[data-testid="lista-escenario"]'), 20000);
    await esperar(gra, pantallaViva('[data-testid="grabadora"]'), 20000);
    anotar('Al subirla al escenario la ven Ana, Beto, el equipo y la página que se transmite', true);
    await dormir(1500);
    const fAna2 = await fuentesDeEquipo(ana); const fBeto2 = await fuentesDeEquipo(beto); const fDora2 = await fuentesDeEquipo(dora);
    anotar('Ana y Beto ya reciben la pantalla Y su sonido', fAna2.includes('screen_share') && fAna2.includes('screen_share_audio') && fBeto2.includes('screen_share') && fBeto2.includes('screen_share_audio'), `${JSON.stringify(fAna2)} ${JSON.stringify(fBeto2)}`);
    anotar('Dora (lobby) sigue sin recibir nada', fDora2.length === 0, JSON.stringify(fDora2));
    anotar('El sonido de la pantalla suena también en la página que se transmite (para que salga en la grabación)', Number(await gra.evaluate(`document.querySelectorAll('audio').length`)) === audiosAntes + 1);
    anotar('La pantalla va grande y la gente en una tira abajo, igual en todas las pantallas', (await ana.evaluate(() => document.querySelector('[data-testid="escenario"]')?.getAttribute('data-diseno'))) === 'tira-abajo'
      && (await marina.evaluate(() => document.querySelector('[data-testid="lista-escenario"]')?.getAttribute('data-diseno'))) === 'tira-abajo'
      && (await gra.evaluate(() => document.querySelector('[data-testid="escena-grabadora"]')?.getAttribute('data-diseno'))) === 'tira-abajo');
    anotar('La pantalla se ve ENTERA (nunca recortada) y con el nombre de quien la comparte', (await ana.evaluate(() => { const m = document.querySelector('[data-testid="escenario"] [data-testid="mosaico-Pantalla"]'); const v = m?.querySelector('video'); return !!v && getComputedStyle(v).objectFit === 'contain' && !!m?.textContent?.includes('Marina'); })));
    anotar('Con la pantalla en el escenario, la cámara de Marina y de Ana siguen a la vista', (await esperar(ana, `(() => { const v = document.querySelector('[data-testid="escenario"] [data-testid="mosaico-Marina"] video'); return !!v && v.videoWidth > 0; })()`).then(() => true, () => false)));
    await foto(ana, 'p2-ana-ve-la-pantalla'); await foto(marina, 'p3-consola-pantalla-en-el-escenario'); await foto(gra, 'p4-lo-que-sale-al-aire');

    // ── 4. Se baja a backstage: deja de llegar a los de adentro ──
    await clic(pablo, 'bajar-pantalla');
    const dejoAna = await llega(ana, noHay('[data-testid="mosaico-Pantalla"]'), 10000);
    await dormir(1500);
    const fAna3 = await fuentesDeEquipo(ana); const fBeto3 = await fuentesDeEquipo(beto);
    anotar('Al bajarla a backstage deja de llegar a Ana y a Beto (a nivel de red) y desaparece del escenario y de la transmisión', dejoAna && sinPantalla(fAna3) && sinPantalla(fBeto3) && (await gra.$('[data-testid="mosaico-Pantalla"]')) === null, `${JSON.stringify(fAna3)} ${JSON.stringify(fBeto3)}`);
    anotar('Vuelve a la vista previa de backstage del equipo', !!(await marina.waitForSelector('[data-testid="tarjeta-pantalla"]', { timeout: 8000 }).catch(() => null)));

    // ── 5. Otra persona del equipo puede cortarla ──
    anotar('A quien no la comparte el botón le dice «Quitar la pantalla de Marina»', (await textoDe(pablo, 'boton-pantalla')).includes('Quitar la pantalla de Marina'));
    anotar('A quien la comparte le dice «Dejar de compartir»', (await textoDe(marina, 'boton-pantalla')).includes('Dejar de compartir'));
    await clic(pablo, 'boton-pantalla');
    await esperar(marina, noHay('[data-testid="tarjeta-pantalla"]'), 10000);
    const sigueCapturando = await llega(marina, `!window.__sala.localParticipant.getTrackPublication('screen_share')`, 8000);
    anotar('Producción corta la pantalla de Marina: desaparece y la moderadora deja de capturar su pantalla', sigueCapturando);

    // ── 6. Producción comparte una presentación (sin sonido) y el servidor no deja que dos compartan a la vez ──
    await clic(pablo, 'boton-pantalla'); await esperar(pablo, hay('[data-testid="elegir-pantalla"]')); await clic(pablo, 'pantalla-presentacion');
    await esperar(marina, pantallaViva('[data-testid="tarjeta-pantalla"]'), 20000);
    anotar('Una presentación llega sin sonido y la moderadora lo ve en la tarjeta («Sin sonido»)', (await textoDe(marina, 'tarjeta-pantalla')).includes('Sin sonido'));
    const otra = await fetch(`${API}/sesiones/${creada.id}/pantalla`, { method: 'POST', headers: cabDe(MARINA), body: JSON.stringify({ accion: 'empezar', modo: 'video', audio: false }) });
    const cuerpoOtra = await otra.json() as { mensaje?: string };
    anotar('Si Marina intenta compartir mientras Pablo comparte, el servidor lo rechaza con un mensaje claro', otra.status === 409 && (cuerpoOtra.mensaje ?? '').includes('Pablo ya está compartiendo'), `${otra.status} ${cuerpoOtra.mensaje ?? ''}`);
    anotar('Mientras Pablo comparte, el botón de Marina ofrece quitarla (no empezar otra)', (await textoDe(marina, 'boton-pantalla')).includes('Quitar la pantalla de Pablo'));
    await clic(marina, 'subir-pantalla'); // la moderadora sube lo que comparte producción
    await esperar(ana, pantallaViva('[data-testid="escenario"]'), 20000);
    await dormir(1200);
    const fAna4 = await fuentesDeEquipo(ana);
    anotar('Ana ve la presentación de Pablo pero no recibe sonido de pantalla (no lo trae)', fAna4.includes('screen_share') && !fAna4.includes('screen_share_audio'), JSON.stringify(fAna4));
    await clic(pablo, 'boton-pantalla'); // Pablo deja de compartir
    await esperar(ana, noHay('[data-testid="mosaico-Pantalla"]'), 10000);
    await esperar(marina, noHay('[data-testid="tarjeta-pantalla"]'), 10000);
    anotar('Quien comparte puede dejar de hacerlo: se quita de todas las pantallas y deja de capturar', await llega(pablo, `!window.__sala.localParticipant.getTrackPublication('screen_share')`, 8000));

    // ── 7. Dejar de compartir desde el aviso del propio navegador («Dejar de compartir») ──
    await clic(pablo, 'boton-pantalla'); await esperar(pablo, hay('[data-testid="elegir-pantalla"]')); await clic(pablo, 'pantalla-presentacion');
    await esperar(marina, hay('[data-testid="tarjeta-pantalla"]'), 20000);
    await pablo.evaluate(() => { const pub = (window as unknown as { __sala: { localParticipant: { getTrackPublication: (s: string) => { track: { mediaStreamTrack: MediaStreamTrack } } } } }).__sala.localParticipant.getTrackPublication('screen_share'); pub.track.mediaStreamTrack.dispatchEvent(new Event('ended')); });
    anotar('Si el navegador termina la captura (botón «Dejar de compartir» de Chrome), la pantalla se quita sola de todas las consolas', await llega(marina, noHay('[data-testid="tarjeta-pantalla"]'), 10000));

    // ── 8. Un video sin sonido (no marcó «Compartir audio de la pestaña»): se comparte pero avisa ──
    await marina.evaluate('window.__sinSonidoPantalla = true');
    await clic(marina, 'boton-pantalla'); await esperar(marina, hay('[data-testid="elegir-pantalla"]')); await clic(marina, 'pantalla-video');
    await esperar(marina, hay('[data-testid="tarjeta-pantalla"]'), 20000);
    await esperar(marina, `(document.querySelector('[data-testid="aviso"]')?.textContent || '').toLowerCase().includes('sin sonido')`, 8000);
    anotar('Un video compartido sin sonido avisa claro («Se comparte sin sonido…») y la tarjeta dice «Sin sonido»', (await textoDe(marina, 'tarjeta-pantalla')).includes('Sin sonido'));
    await clic(marina, 'boton-pantalla');
    await esperar(marina, noHay('[data-testid="tarjeta-pantalla"]'), 10000);
    await marina.evaluate('window.__sinSonidoPantalla = false');

    // ── 9. Si quien comparte recarga la página, no queda una pantalla fantasma ──
    await clic(marina, 'boton-pantalla'); await esperar(marina, hay('[data-testid="elegir-pantalla"]')); await clic(marina, 'pantalla-presentacion');
    await esperar(pablo, hay('[data-testid="tarjeta-pantalla"]'), 20000);
    await marina.reload({ waitUntil: 'domcontentloaded' });
    anotar('Si quien comparte recarga su página, la pantalla se quita sola (no queda una fantasma)', await llega(pablo, noHay('[data-testid="tarjeta-pantalla"]'), 20000));
    await esperar(marina, hay('[data-testid="consola"]'));

    // ── 10. Si quien comparte se desconecta, también se quita ──
    await clic(pablo, 'boton-pantalla'); await esperar(pablo, hay('[data-testid="elegir-pantalla"]')); await clic(pablo, 'pantalla-presentacion');
    await esperar(marina, hay('[data-testid="tarjeta-pantalla"]'), 20000);
    await pablo.close();
    anotar('Si quien comparte se desconecta, la pantalla se quita sola', await llega(marina, noHay('[data-testid="tarjeta-pantalla"]'), 25000));

    marina.on('dialog', (d) => void d.accept());
    await clic(marina, 'terminar');
    await esperar(ana, `document.body.innerText.includes('La sesión terminó')`);
    anotar('Terminar la sesión avisa a todos', true);
  } catch (e) {
    anotar('La prueba se interrumpió', false, (e as Error).message.split('\n')[0]);
  } finally {
    for (const l of lanzados) await l.cerrar();
  }
  const fallas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} pruebas bien`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
