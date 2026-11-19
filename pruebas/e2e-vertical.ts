// Prueba de punta a punta con un CELULAR EN VERTICAL simulado (Chrome sin ventana, cámara sintética de 360×640 y pantalla táctil de 390×844)
// y una laptop de control (cámara 640×360). Revisa que la imagen vertical no se recorte (se ve entera en los recuadros horizontales del equipo),
// que el recuadro propio del participante sea vertical, y que a un celular no se le fuerce una cámara horizontal.
// Requiere el servidor (npm run dev:servidor) y la interfaz (npm run dev:web) encendidos. Uso: npm run e2e:vertical
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { mediosFalsos } from './medios-falsos';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EQUIPO = { email: 'moderadora@ejemplo.test', nombre: 'Marina' };
const CAPTURAS = process.env.CAPTURAS;
const foto = async (pag: Page, nombre: string) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await pag.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) }); } };

const resultados: { prueba: string; ok: boolean }[] = [];
const anotar = (prueba: string, ok: boolean, detalle = '') => { resultados.push({ prueba, ok }); console.log(`${ok ? 'OK ' : 'FALLÓ'}  ${prueba}${detalle ? ` — ${detalle}` : ''}`); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esperar(pagina: Page, fn: string, ms = 15000) {
  try { await pagina.waitForFunction(fn, { polling: 50, timeout: ms }); } catch {
    const texto = await pagina.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '(sin texto)');
    throw new Error(`Se agotó la espera de «${fn.slice(0, 110)}» en ${pagina.url()}. La pantalla decía: ${texto.replace(/\n+/g, ' | ')}`);
  }
}
const lugar = (n: string) => `document.querySelector('[data-testid="dentro"]')?.getAttribute('data-lugar') === ${JSON.stringify(n)}`;
const hay = (sel: string) => `!!document.querySelector(${JSON.stringify(sel)})`;
const clic = (pagina: Page, testid: string) => pagina.$eval(`[data-testid="${testid}"]`, (el) => (el as HTMLElement).click());
const caja = (p: Page, sel: string) => p.evaluate((s: string) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; }, sel);
const imagen = (p: Page, sel: string) => p.evaluate((s: string) => {
  const m = document.querySelector(s); const v = m?.querySelector('video');
  return m && v ? { ajuste: m.getAttribute('data-ajuste-imagen'), fit: getComputedStyle(v).objectFit, medida: m.getAttribute('data-video') } : null;
}, sel);
const proporcion = (m: string | null | undefined) => { const [w, h] = (m ?? '0x1').split('x').map(Number); return w / h; };
const forma = (c: { w: number; h: number } | null) => (c ? `${Math.round(c.w)}×${Math.round(c.h)}` : 'sin recuadro');

async function main() {
  const salud = await fetch('http://localhost:8787/api/salud').catch(() => null);
  if (!salud?.ok) throw new Error('El servidor no está encendido (npm run dev:servidor)');
  const creada = await (await fetch('http://localhost:8787/api/v1/sesiones', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-equipo-email': EQUIPO.email, 'x-equipo-nombre': EQUIPO.nombre },
    body: JSON.stringify({ nombre: `Prueba vertical ${new Date().toISOString().slice(11, 19)}` }),
  })).json() as { id: string; codigo: string };

  const lanzados: { cerrar: () => Promise<void> }[] = [];
  const nuevaPantalla = async (): Promise<Page> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-'));
    const nav = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'] });
    lanzados.push({ cerrar: async () => { await nav.close().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); } });
    const [pagina] = await nav.pages();
    return pagina ?? (await nav.newPage());
  };

  try {
    const consola = await nuevaPantalla();
    await consola.setViewport({ width: 1440, height: 900 });
    await consola.evaluateOnNewDocument(mediosFalsos(640, 360));
    consola.on('pageerror', (e) => console.log('  [consola] error:', String(e).slice(0, 160)));
    await consola.goto(`${WEB}/equipo/${creada.id}?email=${EQUIPO.email}&nombre=${EQUIPO.nombre}`);
    await esperar(consola, hay('[data-testid="consola"]'));
    anotar('La consola abre y se conecta', true);

    // Entra una persona; hasta la revisión de cámara se puede medir antes de «Todo listo».
    const entrar = async (nombre: string, o: { celular: boolean; diag?: boolean }) => {
      const p = await nuevaPantalla();
      if (o.celular) await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      else await p.setViewport({ width: 1280, height: 800 });
      await p.evaluateOnNewDocument(o.celular ? mediosFalsos(360, 640) : mediosFalsos(640, 360));
      p.on('pageerror', (e) => console.log(`  [${nombre}] error:`, String(e).slice(0, 160)));
      await p.goto(`${WEB}/p/${creada.codigo}${o.diag ? '?diag=1' : ''}`);
      await p.waitForSelector('[data-testid="acepto-aviso"]');
      for (let intento = 0; intento < 8; intento++) {
        await p.click('[data-testid="acepto-aviso"]');
        if (await p.$eval('[data-testid="acepto-aviso"]', (el) => (el as HTMLInputElement).checked)) break;
        await dormir(250);
      }
      await p.waitForFunction(`!document.querySelector('[data-testid="aceptar-aviso"]')?.disabled`, { polling: 50, timeout: 10000 });
      await p.click('[data-testid="aceptar-aviso"]');
      await p.waitForSelector('[data-testid="nombre"]');
      await p.type('[data-testid="nombre"]', nombre);
      await p.click('[data-testid="continuar"]');
      await esperar(p, `!!document.querySelector('[data-testid="todo-listo"]') && !document.querySelector('[data-testid="todo-listo"]').disabled`);
      return p;
    };

    // ── El celular vertical ──
    const vera = await entrar('Vera', { celular: true, diag: true });
    const tactil = await vera.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    anotar('El celular simulado se reconoce como aparato táctil (si no, esta prueba no sirve)', tactil === true);

    await esperar(vera, hay('[data-testid="mosaico-Vera"][data-video="360x640"]'));
    const revision = await caja(vera, '[data-testid="mosaico-Vera"]');
    anotar('En la revisión de cámara el recuadro propio es VERTICAL en un celular vertical', !!revision && revision.h > revision.w && Math.abs(revision.w / revision.h - 9 / 16) < 0.03, forma(revision));
    anotar('El recuadro propio no ocupa toda la pantalla (cabe en el 43 % del alto)', !!revision && revision.h <= 844 * 0.43 + 1, forma(revision));
    const sello = await vera.evaluate(() => document.querySelector('[data-testid="diagnostico-camara"]')?.textContent ?? '');
    anotar('Con «?diag=1» el recuadro dice el tamaño real que llega de la cámara', sello.includes('360×640'), sello);
    await foto(vera, 'v1-revision-de-camara-vertical');

    const pedidos = JSON.parse(String(await vera.evaluate('JSON.stringify(window.__pedidos)'))) as string[];
    anotar('A un celular no se le pide ancho ni alto de cámara (no se fuerza horizontal)', pedidos.length > 0 && pedidos.every((x) => !x.includes('"width"') && !x.includes('"height"')), `${pedidos.length} pedidos, ejemplo: ${pedidos[0] ?? '-'}`);

    await vera.click('[data-testid="todo-listo"]');
    await esperar(vera, lugar('lobby'));
    await esperar(vera, hay('[data-testid="dentro"] [data-testid="mosaico-Vera"][data-video="360x640"]'));
    const lobby = await caja(vera, '[data-testid="dentro"] [data-testid="mosaico-Vera"]');
    anotar('En el lobby el recuadro propio también es vertical', !!lobby && lobby.h > lobby.w && Math.abs(lobby.w / lobby.h - 9 / 16) < 0.03, forma(lobby));
    await foto(vera, 'v2-lobby-vertical');

    // ── Una laptop de control: nada cambia para quien manda video horizontal ──
    const hugo = await entrar('Hugo', { celular: false });
    await esperar(hugo, hay('[data-testid="mosaico-Hugo"][data-video="640x360"]'));
    const cajaHugo = await caja(hugo, '[data-testid="mosaico-Hugo"]');
    anotar('En una laptop el recuadro propio sigue siendo horizontal (16:9)', !!cajaHugo && Math.abs(cajaHugo.w / cajaHugo.h - 16 / 9) < 0.03, forma(cajaHugo));
    const pedidosHugo = JSON.parse(String(await hugo.evaluate('JSON.stringify(window.__pedidos)'))) as string[];
    anotar('A una laptop sí se le pide 640×360, ligero', pedidosHugo.some((x) => x.includes('"width"') && x.includes('640')), pedidosHugo.find((x) => x.includes('"width"')) ?? '-');
    await hugo.click('[data-testid="todo-listo"]');
    await esperar(hugo, lugar('lobby'));
    await esperar(consola, hay('[data-testid="fila-lobby-Vera"]'));
    await esperar(consola, hay('[data-testid="fila-lobby-Hugo"]'));

    // ── Sala verde: el equipo ve a Vera entera ──
    await clic(consola, 'llamar-Vera');
    await esperar(vera, lugar('verde'));
    await esperar(consola, hay('[data-testid="lista-verde"] [data-testid="mosaico-Vera"][data-video]'));
    await dormir(400);
    const enVerde = await imagen(consola, '[data-testid="lista-verde"] [data-testid="mosaico-Vera"]');
    anotar('En la sala verde el equipo ve a Vera ENTERA, sin recortar (contain)', enVerde?.fit === 'contain' && enVerde?.ajuste === 'contain', JSON.stringify(enVerde));
    anotar('Lo que llega es de verdad vertical (9:16)', Math.abs(proporcion(enVerde?.medida) - 9 / 16) < 0.03, enVerde?.medida ?? '-');
    await esperar(vera, hay('[data-testid="dentro"][data-lugar="verde"] [data-testid="mosaico-Vera"][data-video]'));
    const pip = await caja(vera, '[data-testid="dentro"] [data-testid="mosaico-Vera"]');
    anotar('Su imagen sobre la del equipo (sala verde) es vertical y chica', !!pip && pip.h > pip.w && pip.w <= 113 && pip.h <= 145, forma(pip));
    await foto(consola, 'v3-consola-sala-verde-con-vera');
    await foto(vera, 'v4-vera-en-sala-verde');

    // ── Backstage ──
    await clic(consola, 'pasar-Vera');
    await esperar(vera, lugar('backstage'));
    await esperar(consola, hay('[data-testid="lista-backstage"] [data-testid="mosaico-Vera"][data-video]'));
    await dormir(400);
    const enBack = await imagen(consola, '[data-testid="lista-backstage"] [data-testid="mosaico-Vera"]');
    anotar('En backstage el equipo la sigue viendo entera', enBack?.fit === 'contain', JSON.stringify(enBack));
    await esperar(vera, hay('[data-testid="dentro"][data-lugar="backstage"] [data-testid="mosaico-Vera"][data-video="360x640"]'));
    const miniatura = await caja(vera, '[data-testid="dentro"] [data-testid="mosaico-Vera"]');
    anotar('Su miniatura «Solo tú te ves aquí» es vertical', !!miniatura && miniatura.h > miniatura.w && miniatura.w <= 129 && miniatura.h <= 145, forma(miniatura));
    await foto(vera, 'v5-vera-en-backstage');

    // ── Escenario: sola, y luego con Hugo (laptop) ──
    await clic(consola, 'subir-Vera');
    await esperar(vera, lugar('escenario'));
    await esperar(consola, hay('[data-testid="lista-escenario"] [data-testid="mosaico-Vera"][data-video]'));
    await dormir(500);
    const enEscenario = await imagen(consola, '[data-testid="lista-escenario"] [data-testid="mosaico-Vera"]');
    anotar('En el escenario, sola, se ve entera (no se le corta la cara)', enEscenario?.fit === 'contain', JSON.stringify(enEscenario));
    const suyo = await imagen(vera, '[data-testid="escenario"] [data-testid="mosaico-Vera"]');
    anotar('En su propio celular, en el escenario, tampoco se recorta', suyo?.fit === 'contain', JSON.stringify(suyo));
    await foto(consola, 'v6-consola-escenario-con-vera-vertical');
    await foto(vera, 'v7-vera-en-escenario');

    await clic(consola, 'llamar-Hugo'); await esperar(hugo, lugar('verde'));
    await clic(consola, 'pasar-Hugo'); await esperar(hugo, lugar('backstage'));
    await clic(consola, 'subir-Hugo'); await esperar(hugo, lugar('escenario'));
    await esperar(consola, hay('[data-testid="lista-escenario"] [data-testid="mosaico-Hugo"][data-video]'));
    await dormir(500);
    const hugoEscena = await imagen(consola, '[data-testid="lista-escenario"] [data-testid="mosaico-Hugo"]');
    anotar('Quien manda video horizontal se sigue llenando como siempre (cover)', hugoEscena?.fit === 'cover', JSON.stringify(hugoEscena));
    await foto(consola, 'v8-consola-escenario-vera-y-hugo');

    // ── Imagen «completa» elegida por el equipo: sigue mandando ──
    await clic(consola, 'boton-diseno').catch(() => undefined);
    if (await consola.$('[data-testid="ajuste-completo"]')) {
      await clic(consola, 'ajuste-completo'); await dormir(500);
      const hugoCompleto = await imagen(consola, '[data-testid="lista-escenario"] [data-testid="mosaico-Hugo"]');
      anotar('Si el equipo elige imagen «completa», todos se ven enteros (incluso la laptop)', hugoCompleto?.fit === 'contain', JSON.stringify(hugoCompleto));
    }

    // ── Girar el celular: la forma se actualiza sola ──
    await vera.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await dormir(600);
    const girado = await caja(vera, '[data-testid="escenario"]');
    anotar('Al girar el celular a horizontal la pantalla se acomoda sin romperse', !!girado && girado.w > 0 && girado.h > 0, forma(girado));

    consola.on('dialog', (d) => void d.accept());
    await clic(consola, 'terminar');
    await esperar(vera, `document.body.innerText.includes('La sesión terminó')`);
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
