// Prueba de punta a punta en un Chrome aparte (sin ventana, con cámara y micrófono de mentira): una consola del equipo
// y tres participantes de verdad, cada uno en su pantalla. Mide cuánto tarda cada cambio y revisa que nadie vea de más.
// Requiere el servidor (npm run dev:servidor) y la interfaz (npm run dev:web) encendidos. Uso: npm run e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EQUIPO = { email: 'moderadora@ejemplo.test', nombre: 'Marina' };
const NOMBRES = ['Ana', 'Beto', 'Carla'] as const;

const CAPTURAS = process.env.CAPTURAS; // carpeta donde guardar capturas de pantalla (opcional)
const foto = async (pag: Page, nombre: string) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await pag.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) }); } };

const resultados: { prueba: string; ok: boolean; detalle: string }[] = [];
const anotar = (prueba: string, ok: boolean, detalle = '') => { resultados.push({ prueba, ok, detalle }); console.log(`${ok ? 'OK ' : 'FALLÓ'}  ${prueba}${detalle ? ` — ${detalle}` : ''}`); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ahora = () => performance.now();

async function esperar(pagina: Page, fn: string, arg: unknown = null, ms = 15000): Promise<number> {
  const t0 = ahora();
  try {
    await pagina.waitForFunction(fn, { polling: 16, timeout: ms }, arg);
  } catch {
    const texto = await pagina.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '(sin texto)');
    throw new Error(`Se agotó la espera de «${fn.slice(0, 100)}» en ${pagina.url()}. La pantalla decía: ${texto.replace(/\n+/g, ' | ')}`);
  }
  return Math.round(ahora() - t0);
}

// En este entorno el Chrome sin ventana no logra abrir cámara ni micrófono (ni siquiera los de mentira que trae), así que
// cada página recibe una cámara y un micrófono sintéticos (un cuadro en movimiento y un tono). Lo que se prueba es nuestro código y LiveKit;
// la apertura de la cámara real la hace el navegador y se revisa a mano en celulares y computadoras de verdad.
const MEDIOS_FALSOS = `(() => {
  window.__TRAZA = true;
  let contexto = null;
  const crearFlujo = (video, audio) => {
    const flujo = new MediaStream();
    if (video) {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const x = c.getContext('2d'); let n = 0;
      setInterval(() => { x.fillStyle = '#2a6f5a'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#ffffff'; x.fillRect((n * 8) % 600, 280, 40, 40); n++; }, 66);
      c.captureStream(15).getVideoTracks().forEach((t) => flujo.addTrack(t));
    }
    if (audio) {
      contexto = contexto || new AudioContext();
      const osc = contexto.createOscillator(); const g = contexto.createGain(); g.gain.value = 0.02;
      const d = contexto.createMediaStreamDestination(); osc.connect(g); g.connect(d); osc.start();
      d.stream.getAudioTracks().forEach((t) => flujo.addTrack(t));
    }
    return flujo;
  };
  navigator.mediaDevices.getUserMedia = async (c) => crearFlujo(!!(c && c.video), !!(c && c.audio));
  navigator.mediaDevices.enumerateDevices = async () => [
    { deviceId: 'cam-de-prueba', kind: 'videoinput', label: 'Cámara de prueba', groupId: 'g1' },
    { deviceId: 'mic-de-prueba', kind: 'audioinput', label: 'Micrófono de prueba', groupId: 'g1' },
  ];
})();`;

// A qué personas está REALMENTE suscrita una pantalla (video o audio recibido), no solo lo que dibuja.
const suscritosDe = async (pag: Page): Promise<Record<string, string[]>> => JSON.parse(String(await pag.evaluate(`JSON.stringify((() => {
  const sala = window.__sala; const r = {};
  if (!sala) return r;
  for (const p of sala.remoteParticipants.values()) { const tipos = [...p.trackPublications.values()].filter((t) => t.isSubscribed).map((t) => t.kind); if (tipos.length) r[p.identity] = tipos; }
  return r; })())`)));

// Línea de tiempo entre pantallas (todas comparten el reloj de esta computadora): qué pasó y cuándo, desde el clic.
async function lineaDeTiempo(todas: Record<string, Page>, titulo: string) {
  const eventos: { quien: string; t: number; e: string; d?: unknown }[] = [];
  for (const [quien, pag] of Object.entries(todas)) {
    const lista = JSON.parse(String(await pag.evaluate('JSON.stringify(window.__traza || [])'))) as { t: number; e: string; d?: unknown }[];
    for (const x of lista) eventos.push({ quien, ...x });
  }
  eventos.sort((a, b) => a.t - b.t);
  const t0 = eventos.find((x) => x.e === 'clic')?.t ?? eventos[0]?.t ?? 0;
  console.log(`\n  ── ${titulo} ──`);
  for (const x of eventos) console.log(`  +${String(Math.round(x.t - t0)).padStart(5)} ms  ${x.quien.padEnd(7)} ${x.e}${x.d ? ' ' + JSON.stringify(x.d) : ''}`);
}
const limpiarTraza = (todas: Record<string, Page>) => Promise.all(Object.values(todas).map((p) => p.evaluate('window.__traza = []')));

// Funciones que se evalúan DENTRO de las páginas
const JS = {
  lugar: (n: string) => `(document.querySelector('[data-testid="dentro"]')?.getAttribute('data-lugar')) === ${JSON.stringify(n)}`,
  videoSonando: (nombre: string) => `(() => { const v = document.querySelector('[data-testid="mosaico-${nombre}"] video'); return !!v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused; })()`,
  hay: (sel: string) => `!!document.querySelector(${JSON.stringify(sel)})`,
  noHay: (sel: string) => `!document.querySelector(${JSON.stringify(sel)})`,
  enSeccion: (seccion: 'lista-lobby' | 'lista-verde' | 'lista-escenario' | 'lista-backstage', nombre: string) =>
    `!!document.querySelector('[data-testid="${seccion}"] [data-testid="mosaico-${nombre}"], [data-testid="${seccion}"] [data-testid="fila-lobby-${nombre}"], [data-testid="${seccion}"] [data-testid="panel-verde-${nombre}"]')`,
  texto: (t: string) => `document.body.innerText.includes(${JSON.stringify(t)})`,
};

async function main() {
  const salud = await fetch('http://localhost:8787/api/salud').catch(() => null);
  if (!salud?.ok) throw new Error('El servidor no está encendido (npm run dev:servidor)');

  const creada = await (await fetch('http://localhost:8787/api/v1/sesiones', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-equipo-email': EQUIPO.email, 'x-equipo-nombre': EQUIPO.nombre },
    body: JSON.stringify({ nombre: `Prueba automática ${new Date().toISOString().slice(11, 19)}` }),
  })).json() as { id: string; codigo: string };

  // Sin aceptar el aviso de privacidad nadie entra (lo exige el servidor, no solo la pantalla).
  const sinAviso = await fetch(`http://localhost:8787/api/p/${creada.codigo}/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Intruso' }) });
  anotar('Sin aceptar el aviso de privacidad el servidor no deja entrar', sinAviso.status === 400, `estado ${sinAviso.status}`);

  // Integración con el Hub: una sesión por evento del calendario, y la llave de Mux nunca sale del servidor.
  {
    const API = 'http://localhost:8787/api';
    const cab = { 'content-type': 'application/json', 'x-equipo-email': EQUIPO.email, 'x-equipo-nombre': EQUIPO.nombre };
    const LLAVE = 'llave-de-prueba-e2e-1234'; // inventada
    const evento = `evento-prueba-${Date.now()}`;
    const crear = (cuerpo: object) => fetch(`${API}/v1/sesiones`, { method: 'POST', headers: cab, body: JSON.stringify(cuerpo) });
    const datos = { nombre: 'Prueba Hub', externoId: evento, muxStreamKey: LLAVE, observacionUrl: 'https://ejemplo.test/s/abc' };
    const r1 = await crear(datos); const t1 = await r1.text(); const j1 = JSON.parse(t1);
    const r2 = await crear(datos); const j2 = await r2.json();
    anotar('Crear la sesión de un evento devuelve sus links y dice que la transmisión está lista', r1.status === 201 && !!j1.linkParticipantes && !!j1.linkEquipo && j1.transmision === 'lista', `estado ${r1.status}`);
    anotar('Pedirla otra vez devuelve la misma sesión, no crea otra', r2.status === 200 && j2.id === j1.id && j2.yaExistia === true);
    anotar('La respuesta NUNCA incluye la llave de Mux', !t1.includes(LLAVE));
    anotar('El listado de sesiones tampoco la incluye', !(await (await fetch(`${API}/sesiones`, { headers: cab })).text()).includes(LLAVE));
    const consulta = await fetch(`${API}/v1/sesiones/evento/${evento}`, { headers: cab });
    const tc = await consulta.text();
    anotar('Se puede consultar la sesión de un evento, sin la llave', consulta.status === 200 && JSON.parse(tc).id === j1.id && !tc.includes(LLAVE));
    anotar('Un evento sin sesión da 404', (await fetch(`${API}/v1/sesiones/evento/no-existe-${Date.now()}`, { headers: cab })).status === 404);
    anotar('Una llave con formato raro se rechaza', (await crear({ nombre: 'X', muxStreamKey: 'llave con espacios y "comillas"' })).status === 400);
    anotar('Una página de observación que no es https se rechaza', (await crear({ nombre: 'X', observacionUrl: 'http://ejemplo.test/s/abc' })).status === 400);
    const sinLlave = await (await crear({ nombre: 'Sin llave', externoId: `${evento}-b` })).json();
    anotar('Sin llave de Mux la sesión se crea y dice «sin-llave»', sinLlave.transmision === 'sin-llave');
  }

  // Un Chrome distinto por cada actor (consola y participantes): así todas las pantallas están al frente y ninguna se frena,
  // como pasaría en computadoras distintas.
  const lanzados: { cerrar: () => Promise<void> }[] = [];
  const nuevaPantalla = async (): Promise<Page> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-'));
    const nav = await puppeteer.launch({
      executablePath: CHROME, headless: true, userDataDir: dir,
      args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
    });
    lanzados.push({ cerrar: async () => { await nav.close().catch(() => undefined); fs.rmSync(dir, { recursive: true, force: true }); } });
    const [pagina] = await nav.pages();
    return pagina ?? (await nav.newPage());
  };
  try {
    // ── Consola del equipo ──
    const consola = await nuevaPantalla();
    await consola.setViewport({ width: 1440, height: 900 });
    await consola.evaluateOnNewDocument(MEDIOS_FALSOS);
    consola.on('pageerror', (e) => console.log('  [consola] error:', String(e).slice(0, 160)));
    await consola.goto(`${WEB}/equipo/${creada.id}?email=${EQUIPO.email}&nombre=${EQUIPO.nombre}`);
    await esperar(consola, JS.hay('[data-testid="consola"]'));
    anotar('La consola abre y se conecta', true);

    // ── Tres participantes entran por el link único ──
    const paginas: Record<string, Page> = {};
    const entrarComo = async (nombre: string): Promise<Page> => {
      const p = await nuevaPantalla();
      await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      await p.evaluateOnNewDocument(MEDIOS_FALSOS);
      p.on('pageerror', (e) => console.log(`  [${nombre}] error:`, String(e).slice(0, 160)));
      p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`  [${nombre}] ${m.type()}: ${m.text().slice(0, 200)}`); });
      await p.goto(`${WEB}/p/${creada.codigo}`);
      await p.waitForSelector('[data-testid="acepto-aviso"]');
      for (let intento = 0; intento < 8; intento++) { // el clic puede caer mientras la pantalla todavía se acomoda: se repite hasta que quede marcada
        await p.click('[data-testid="acepto-aviso"]');
        if (await p.$eval('[data-testid="acepto-aviso"]', (el) => (el as HTMLInputElement).checked)) break;
        await dormir(250);
      }
      await p.waitForFunction(`!document.querySelector('[data-testid="aceptar-aviso"]')?.disabled`, { polling: 50, timeout: 10000 });
      await p.click('[data-testid="aceptar-aviso"]');
      await p.waitForSelector('[data-testid="nombre"]');
      await p.type('[data-testid="nombre"]', nombre);
      await p.click('[data-testid="continuar"]');
      await esperar(p, `!document.querySelector('[data-testid="todo-listo"]')?.disabled && !!document.querySelector('[data-testid="todo-listo"]')`);
      await p.click('[data-testid="todo-listo"]');
      await esperar(p, JS.lugar('lobby'));
      return p;
        };
    for (const nombre of NOMBRES) paginas[nombre] = await entrarComo(nombre);
    for (const n of NOMBRES) await esperar(consola, JS.enSeccion('lista-lobby', n));
    anotar('Los tres entran al lobby y la consola los ve', true);
    await dormir(800);
    await foto(consola, '1-consola-con-tres-en-el-lobby'); await foto(paginas[NOMBRES[0]], '2-participante-en-el-lobby');

    // Calibración: ¿alguna pantalla corre con los relojes frenados? (un reloj de 100 ms debe durar ~100 ms en todas)
    const calibracion: Record<string, string> = {};
    for (const [nombre, pag] of [['consola', consola], ...Object.entries(paginas)] as [string, Page][]) {
      const r = await pag.evaluate(`(async () => { const t = performance.now(); await new Promise((r) => setTimeout(r, 100)); return document.visibilityState + ' ' + Math.round(performance.now() - t) + ' ms'; })()`);
      calibracion[nombre] = String(r);
    }
    const frenadas = Object.entries(calibracion).filter(([, v]) => Number(v.split(' ')[1]) > 400);
    anotar('Ninguna pantalla tiene los relojes frenados', frenadas.length === 0, JSON.stringify(calibracion));

    // ── Llamar a la sala verde, pasar a la sesión ──
    const clic = (pagina: Page, testid: string) => pagina.$eval(`[data-testid="${testid}"]`, (el) => (el as HTMLElement).click());
    for (const n of NOMBRES) {
      let t0 = ahora();
      const marcas: Record<string, number> = {};
      const marca = (clave: string, p: Promise<unknown>) => p.then(() => { marcas[clave] = Math.round(ahora() - t0); });
      await clic(consola, `llamar-${n}`);
      await Promise.all([
        marca('la consola lo pasa a «Sala verde»', esperar(consola, JS.enSeccion('lista-verde', n))),
        marca('su pantalla pasa a verde', esperar(paginas[n], JS.lugar('verde'))),
        marca('él ve al equipo en video', esperar(paginas[n], JS.videoSonando('Marina'))),
        marca('el equipo lo ve en video', esperar(consola, JS.videoSonando(n))),
      ]);
      anotar(`${n}: sala verde con video en las dos pantallas`, true, JSON.stringify(marcas));
      if (n === NOMBRES[0]) { await dormir(700); await foto(consola, '3-consola-llamando-a-la-sala-verde'); await foto(paginas[n], '4-participante-en-la-sala-verde'); }
      t0 = ahora();
      await clic(consola, `pasar-${n}`);
      await esperar(paginas[n], JS.lugar('backstage'));
      await esperar(consola, JS.enSeccion('lista-backstage', n));
      await esperar(consola, JS.videoSonando(n));
      anotar(`${n}: pasa a la sesión (backstage) y el equipo lo ve en vivo`, true, `${Math.round(ahora() - t0)} ms`);
    }

    // ── Privacidad: en backstage cada quien ve solo lo suyo ──
    for (const quien of NOMBRES) {
      const otros = NOMBRES.filter((x) => x !== quien);
      const texto = await paginas[quien].evaluate(() => document.body.innerText);
      const videosAjenos = await paginas[quien].evaluate((nombres: string[]) => nombres.filter((o) => !!document.querySelector(`[data-testid="mosaico-${o}"]`)), otros as string[]);
      anotar(`${quien} en backstage no ve a nadie más (nombres ni video)`, otros.every((o) => !texto.includes(o)) && videosAjenos.length === 0);
    }

    // ── Aislamiento REAL (transporte): en backstage nadie recibe ni video ni audio de nadie más ──
    await dormir(2500);
    const ids: Record<string, string> = {};
    for (const n of NOMBRES) ids[n] = String(await paginas[n].evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith('estudio:')) as string) as string).entrada.participanteId));
    for (const quien of NOMBRES) {
      const recibe = await suscritosDe(paginas[quien]);
      anotar(`${quien} en backstage no recibe NADA de nadie (video ni audio, a nivel de red)`, Object.keys(recibe).length === 0, JSON.stringify(recibe));
    }

    // ── La moderadora sube primero al escenario (como en una sesión real): todos ya reciben algo del escenario ──
    const [a, b, c] = NOMBRES;
    const todas = { consola, ...paginas };
    {
      const t0 = ahora();
      await clic(consola, 'mi-escenario');
      await Promise.all(NOMBRES.map((n) => esperar(paginas[n], JS.videoSonando('Marina'))));
      anotar('La moderadora sube al escenario y los tres la ven', true, `${Math.round(ahora() - t0)} ms`);
    }

    await dormir(500);
    await foto(paginas[b], '5-participante-en-backstage-con-la-moderadora-en-pantalla');

    // ── Subir y bajar: lo que más importa. Varias rondas para ver la distribución, no un caso suertudo ──
    const trazaDe = async (pag: Page) => JSON.parse(String(await pag.evaluate('JSON.stringify(window.__traza || [])'))) as { t: number; e: string; d?: { de?: string; tipo?: string } }[];
    const percentil = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
    const muestras = { interfaz: [] as number[], audio: [] as number[], video: [] as number[], dejaDeLlegar: [] as number[] };

    const promover = async (quien: string) => {
      const otros = NOMBRES.filter((x) => x !== quien);
      await limpiarTraza(todas);
      const t0 = ahora();
      const marcas: Record<string, number> = {};
      const espera = (clave: string, p: Promise<unknown>) => p.then(() => { marcas[clave] = Math.round(ahora() - t0); });
      await clic(consola, `subir-${quien}`);
      await Promise.all([
        espera('consola', esperar(consola, JS.enSeccion('lista-escenario', quien))),
        espera('su pantalla', esperar(paginas[quien], JS.lugar('escenario'))),
        ...otros.map((o) => espera(`video→${o}`, esperar(paginas[o], JS.videoSonando(quien)))),
      ]);
      const tClic = (await trazaDe(consola)).find((x) => x.e === 'clic')?.t ?? 0;
      for (const o of otros) {
        const ev = (await trazaDe(paginas[o])).find((x) => x.e === 'suscrito' && x.d?.de === ids[quien] && x.d?.tipo === 'audio' && x.t >= tClic);
        if (ev) marcas[`audio→${o}`] = Math.round(ev.t - tClic);
      }
      muestras.interfaz.push(Math.max(marcas['consola'], marcas['su pantalla']));
      for (const [k, v] of Object.entries(marcas)) { if (k.startsWith('video→')) muestras.video.push(v); if (k.startsWith('audio→')) muestras.audio.push(v); }
      if (process.env.TRAZA) await lineaDeTiempo(todas, `Línea de tiempo al subir a ${quien}`);
      return marcas;
    };

    const degradar = async (quien: string) => {
      const otros = NOMBRES.filter((x) => x !== quien);
      const t0 = ahora();
      await clic(consola, `bajar-${quien}`);
      await Promise.all([
        esperar(consola, JS.enSeccion('lista-backstage', quien)),
        esperar(paginas[quien], JS.lugar('backstage')),
        ...otros.map((o) => esperar(paginas[o], JS.noHay(`[data-testid="mosaico-${quien}"] video`))),
      ]);
      const pantallas = Math.round(ahora() - t0);
      // y a nivel de red: ¿cuánto tarda en dejar de llegarles de verdad su video y su audio?
      await Promise.all(otros.map(async (o) => { for (let i = 0; i < 400; i++) { if (!(await suscritosDe(paginas[o]))[ids[quien]]) return; await dormir(15); } }));
      const red = Math.round(ahora() - t0);
      muestras.dejaDeLlegar.push(red);
      return { pantallas, red };
    };

    for (const ronda of [0, 1]) {
      for (const quien of [a, b, c]) {
        const m = await promover(quien);
        const d = await degradar(quien);
        console.log(`  ronda ${ronda + 1} · ${quien}: ${JSON.stringify(m)} · al bajar: pantallas ${d.pantallas} ms, red ${d.red} ms`);
        await dormir(600);
      }
    }
    const stat = (xs: number[]) => `n=${xs.length} · mediana ${percentil(xs, 0.5)} ms · p90 ${percentil(xs, 0.9)} ms · máx ${Math.max(...xs)} ms`;
    anotar('SUBIR: la pantalla cambia al instante (consola y la propia persona)', percentil(muestras.interfaz, 1) <= 150, stat(muestras.interfaz));
    anotar('SUBIR: el audio de quien sube les llega a los demás', percentil(muestras.audio, 0.9) <= 1000, stat(muestras.audio));
    anotar('SUBIR: el video de quien sube se ve en las pantallas de los demás', percentil(muestras.video, 0.9) <= 1500, stat(muestras.video));
    anotar('BAJAR: deja de llegarles su video y audio a nivel de red', percentil(muestras.dejaDeLlegar, 0.9) <= 1500, stat(muestras.dejaDeLlegar));

    // Quien sigue en backstage ve a los de pantalla (la prueba anterior ya los subió y bajó; dejamos a dos arriba y revisamos)
    await promover(a); await promover(b);
    await dormir(900);
    await foto(consola, '6-consola-con-dos-en-pantalla'); await foto(paginas[a], '7-participante-en-pantalla'); await foto(paginas[c], '8-participante-en-backstage-viendo-el-escenario');
    const ccVe = await paginas[c].evaluate((nombres: string[]) => nombres.map((n) => !!document.querySelector(`[data-testid="mosaico-${n}"] video`)), [a, b]);
    anotar(`${c} (backstage) ve a ${a} y ${b} en pantalla`, ccVe.every(Boolean));
    await degradar(b); await degradar(a);

    // ── Ráfaga: 40 subir/bajar seguidos sobre la misma persona, cada 50 ms, desde la consola ──
    {
      let ultimo = 'backstage';
      for (let i = 0; i < 40; i++) {
        const testid = ultimo === 'backstage' ? `subir-${a}` : `bajar-${a}`;
        const hay = await consola.$(`[data-testid="${testid}"]`);
        if (hay) { await clic(consola, testid); ultimo = ultimo === 'backstage' ? 'escenario' : 'backstage'; }
        await dormir(50);
      }
      // Debe quedar el ÚLTIMO estado pedido, igual en todas las pantallas, y sin atorarse.
      await dormir(2500);
      const enConsola = await consola.evaluate((n: string) => (document.querySelector('[data-testid="lista-escenario"] [data-testid="mosaico-' + n + '"]') ? 'escenario' : 'backstage'), a);
      const enSuPantalla = await paginas[a].evaluate(() => document.querySelector('[data-testid="dentro"]')?.getAttribute('data-lugar'));
      const otrosLoVen = await Promise.all([b, c].map((o) => paginas[o].evaluate((n: string) => !!document.querySelector('[data-testid="mosaico-' + n + '"] video'), a)));
      const coincide = enConsola === ultimo && enSuPantalla === ultimo && otrosLoVen.every((v) => v === (ultimo === 'escenario'));
      anotar('Ráfaga de 40 cambios: todas las pantallas terminan igual que el último pedido', coincide, `pedido=${ultimo} consola=${enConsola} suPantalla=${enSuPantalla} otrosLoVen=${otrosLoVen.join('/')}`);
      if (ultimo === 'escenario') { await clic(consola, `bajar-${a}`); await esperar(paginas[a], JS.lugar('backstage')); }
    }

    // ── La moderadora se va a backstage: su viñeta debe seguir viéndose (antes salía gris, con una pista silenciada) ──
    {
      await clic(consola, 'ir-backstage');
      await esperar(consola, JS.hay('[data-testid="mi-vineta-backstage"]'));
      let ve = false;
      try {
        await consola.waitForFunction(`(() => { const v = document.querySelector('[data-testid="mi-vineta-backstage"] video'); const t = v && v.srcObject && v.srcObject.getVideoTracks()[0]; return !!v && !!t && t.readyState === 'live' && !t.muted && v.videoWidth > 0 && v.readyState >= 2 && !v.paused; })()`, { timeout: 6000, polling: 100 });
        ve = true;
      } catch { /* se anota abajo */ }
      anotar('La moderadora en backstage se sigue viendo (no sale gris)', ve);
      await clic(consola, 'volver-escenario');
      await esperar(consola, JS.enSeccion('lista-escenario', 'Marina'));
      anotar('Un clic en su viñeta la regresa al escenario', true);
    }

    // ── El equipo silencia el micrófono de un participante ──
    {
      const micActivo = () => paginas[a].evaluate(() => !!(window as unknown as { __sala?: { localParticipant: { isMicrophoneEnabled: boolean } } }).__sala?.localParticipant.isMicrophoneEnabled);
      anotar(`${a} empieza con el micrófono encendido`, await micActivo());
      await clic(consola, `silenciar-${a}`);
      await esperar(paginas[a], JS.hay('[data-testid="aviso-silenciado"]'));
      await dormir(800);
      anotar(`Silenciar a ${a}: su micrófono se apaga y su pantalla lo explica`, !(await micActivo()) && (await paginas[a].$eval('[data-testid="boton-mic"]', (el) => (el as HTMLButtonElement).disabled)));
      await paginas[a].evaluate(`(async () => { try { await window.__sala.localParticipant.setMicrophoneEnabled(true); } catch (e) {} })()`);
      await dormir(1500);
      anotar(`${a} no puede volver a encender el micrófono por su cuenta`, !(await micActivo()));
      await clic(consola, `silenciar-${a}`);
      await esperar(paginas[a], JS.noHay('[data-testid="aviso-silenciado"]'));
      await dormir(600);
      anotar(`Al permitirle hablar, el micrófono NO se enciende solo`, !(await micActivo()));
      await clic(paginas[a], 'boton-mic');
      let vuelve = false;
      for (let i = 0; i < 30 && !vuelve; i++) { await dormir(100); vuelve = await micActivo(); }
      anotar(`${a} decide encender su micrófono y funciona`, vuelve);
    }

    // ── Cada participante controla su cámara y su micrófono en TODO momento (backstage, sala verde y escenario) ──
    {
      const disp = () => paginas[a].evaluate(() => { const lp = (window as unknown as { __sala: { localParticipant: { isCameraEnabled: boolean; isMicrophoneEnabled: boolean } } }).__sala.localParticipant; return { cam: lp.isCameraEnabled, mic: lp.isMicrophoneEnabled }; });
      const esperarDisp = async (cam: boolean, mic: boolean, ms = 5000) => { const t0 = ahora(); while (ahora() - t0 < ms) { const d = await disp(); if (d.cam === cam && d.mic === mic) return true; await dormir(100); } return false; };
      const probar = async (lugar: string) => {
        await esperar(paginas[a], JS.lugar(lugar));
        anotar(`${a} en ${lugar}: empieza con cámara y micrófono encendidos`, await esperarDisp(true, true));
        await clic(paginas[a], 'boton-cam'); await clic(paginas[a], 'boton-mic');
        const apagados = await esperarDisp(false, false);
        await dormir(2500); // que ningún cambio de la pantalla se los vuelva a encender
        const d = await disp();
        if (lugar === 'backstage') await foto(paginas[a], '9-participante-con-camara-y-microfono-apagados');
        anotar(`${a} en ${lugar}: apaga su cámara y su micrófono y se quedan apagados`, apagados && !d.cam && !d.mic, JSON.stringify(d));
      };
      await probar('backstage');
      // Lo que apagó sigue apagado al cambiar de lugar (la sala verde, el escenario): la decisión es suya.
      await clic(consola, `verde-${a}`);
      await esperar(paginas[a], JS.lugar('verde'));
      await dormir(2500);
      const enVerde = await disp();
      anotar(`${a}: al regresarlo a la sala verde, lo que apagó sigue apagado`, !enVerde.cam && !enVerde.mic, JSON.stringify(enVerde));
      await clic(paginas[a], 'boton-cam'); await clic(paginas[a], 'boton-mic');
      anotar(`${a} en verde: vuelve a encender cámara y micrófono por su cuenta`, await esperarDisp(true, true));
      await clic(paginas[a], 'boton-cam'); await clic(paginas[a], 'boton-mic');
      anotar(`${a} en verde: los vuelve a apagar y se quedan apagados`, await esperarDisp(false, false) && (await dormir(2000), !(await disp()).cam));
      await clic(consola, `pasar-${a}`);
      await esperar(paginas[a], JS.lugar('backstage'));
      await clic(consola, `subir-${a}`);
      await esperar(paginas[a], JS.lugar('escenario'));
      await dormir(2500);
      const enEscenario = await disp();
      anotar(`${a}: al subirlo al escenario, lo que apagó sigue apagado`, !enEscenario.cam && !enEscenario.mic, JSON.stringify(enEscenario));
      await clic(paginas[a], 'boton-cam'); await clic(paginas[a], 'boton-mic');
      anotar(`${a} en el escenario: enciende cámara y micrófono por su cuenta`, await esperarDisp(true, true));
      await clic(consola, `bajar-${a}`);
      await esperar(paginas[a], JS.lugar('backstage'));
    }

    // ── Diseños del escenario: los elige la consola y TODAS las pantallas los ven igual ──
    {
      await promover(a); await promover(b);
      await dormir(600);
      const ancho = (pagina: Page, testid: string, quien: string) => pagina.evaluate((id: string, q: string) => document.querySelector(`[data-testid="${id}"] [data-testid="mosaico-${q}"]`)?.getBoundingClientRect().width ?? 0, testid, quien);
      const disenoDe = (pagina: Page, testid: string) => pagina.evaluate((id: string) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-diseno'), testid);
      const todasVen = async (tipo: string) => {
        const vistos = await Promise.all([disenoDe(consola, 'lista-escenario'), disenoDe(paginas[a], 'escenario'), disenoDe(paginas[b], 'escenario')]);
        return vistos.every((v) => v === tipo);
      };
      // La ventana de diseños se queda abierta al elegir (para poder fijar a alguien enseguida): solo se abre si está cerrada.
      const abrir = async () => { if (!(await consola.$('[data-testid="diseno-auto"]'))) await clic(consola, 'boton-diseno'); };
      const elegir = async (tipo: string) => { await abrir(); await clic(consola, `diseno-${tipo}`); await dormir(500); };

      anotar('El diseño empieza en cuadrícula automática para todos', await todasVen('auto'));
      await elegir('foco');
      anotar('Elegir «foco» en la consola lo cambia en todas las pantallas', await todasVen('foco'));
      const [primero, otro] = await Promise.all([ancho(consola, 'lista-escenario', 'Marina'), ancho(consola, 'lista-escenario', a)]);
      anotar('En foco el primero del escenario sale mucho más grande que los demás', primero > otro * 2, `${Math.round(primero)} px contra ${Math.round(otro)} px`);

      // Fijar a otra persona: ahora ella va grande.
      await abrir();
      const valor = await consola.evaluate((nombre: string) => [...document.querySelectorAll('[data-testid="fijar"] option')].find((o) => o.textContent === nombre)?.getAttribute('value') ?? '', b);
      await consola.select('[data-testid="fijar"]', valor);
      await dormir(600);
      const [grandeB, chicoA] = await Promise.all([ancho(consola, 'lista-escenario', b), ancho(consola, 'lista-escenario', a)]);
      anotar(`Fijar a ${b}: ahora ${b} va grande`, grandeB > chicoA * 2, `${Math.round(grandeB)} px contra ${Math.round(chicoA)} px`);
      const grandeEnSuPantalla = await Promise.all([ancho(paginas[a], 'escenario', b), ancho(paginas[a], 'escenario', 'Marina')]);
      anotar(`Los participantes también ven a ${b} grande`, grandeEnSuPantalla[0] > grandeEnSuPantalla[1] * 2, `${Math.round(grandeEnSuPantalla[0])} px contra ${Math.round(grandeEnSuPantalla[1])} px`);

      await elegir('redondas');
      anotar('Elegir «viñetas redondas» lo cambia en todas las pantallas', await todasVen('redondas'));
      await foto(consola, '10-consola-vinetas-redondas');
      await elegir('lado');
      anotar('Elegir «lado a lado» lo cambia en todas las pantallas', await todasVen('lado'));
      await elegir('tira-abajo');
      anotar('Elegir «foco con tira abajo» lo cambia en todas las pantallas', await todasVen('tira-abajo'));
      const posicion = (testid: string, quien: string) => consola.evaluate((id: string, q: string) => { const r = document.querySelector(`[data-testid="${id}"] [data-testid="mosaico-${q}"]`)?.getBoundingClientRect(); return r ? { arriba: r.top, ancho: r.width } : null; }, testid, quien);
      const [pg, pc] = await Promise.all([posicion('lista-escenario', b), posicion('lista-escenario', a)]); // Beto sigue fijado: es el grande
      anotar('En tira abajo la persona grande queda arriba y las demás debajo', !!pg && !!pc && pg.arriba < pc.arriba && pg.ancho > pc.ancho * 1.3, JSON.stringify({ grande: pg, otra: pc }));
      await elegir('fila');
      anotar('Elegir «fila centrada» lo cambia en todas las pantallas', await todasVen('fila'));

      // Forma, ajuste de la imagen y fondo: también los ven todos igual.
      const atributo = (pagina: Page, testid: string, nombre: string) => pagina.evaluate((id: string, n: string) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute(n), testid, nombre);
      const todasCon = async (nombre: string, valor: string) => (await Promise.all([atributo(consola, 'lista-escenario', nombre), atributo(paginas[a], 'escenario', nombre), atributo(paginas[b], 'escenario', nombre)])).every((v) => v === valor);
      await abrir(); await clic(consola, 'forma-circulo'); await dormir(500);
      anotar('Elegir «círculo» lo cambia en todas las pantallas', await todasCon('data-forma', 'circulo'));
      const caja = await consola.evaluate((q: string) => { const r = document.querySelector(`[data-testid="lista-escenario"] [data-testid="mosaico-${q}"]`)?.getBoundingClientRect(); return r ? { ancho: r.width, alto: r.height } : null; }, a);
      anotar('En círculo cada viñeta es cuadrada por dentro (ancho igual al alto), incluido el moderador', !!caja && Math.abs(caja.ancho - caja.alto) <= 2, JSON.stringify(caja));
      const cajaMod = await consola.evaluate(() => { const r = document.querySelector('[data-testid="lista-escenario"] [data-testid="mosaico-Marina"]')?.getBoundingClientRect(); return r ? { ancho: r.width, alto: r.height } : null; });
      anotar('El moderador también queda en círculo', !!cajaMod && Math.abs(cajaMod.ancho - cajaMod.alto) <= 2, JSON.stringify(cajaMod));
      await clic(consola, 'ajuste-completo'); await dormir(500);
      anotar('Elegir imagen «completa» lo cambia en todas las pantallas', await todasCon('data-ajuste', 'completo'));
      const ajusteVideo = await consola.evaluate((q: string) => { const v = document.querySelector(`[data-testid="lista-escenario"] [data-testid="mosaico-${q}"] video`); return v ? getComputedStyle(v).objectFit : 'sin video'; }, a);
      anotar('Con imagen completa el video no se recorta (object-fit: contain)', ajusteVideo === 'contain', ajusteVideo);
      await clic(consola, 'fondo-negro'); await dormir(500);
      anotar('Elegir fondo negro lo cambia en todas las pantallas', await todasCon('data-fondo', 'negro'));
      const color = await consola.evaluate(() => getComputedStyle(document.querySelector('[data-testid="lista-escenario"]')!).backgroundColor);
      anotar('El fondo negro se pinta de verdad', color === 'rgb(20, 24, 26)', color);
      await foto(consola, '11-consola-fila-circulos-completo-negro');
      await clic(consola, 'forma-redondeada'); await clic(consola, 'ajuste-llenar'); await clic(consola, 'fondo-gris'); await dormir(900); // tres cambios seguidos, sin pausa
      anotar('Tres cambios de diseño muy seguidos no se pisan entre sí', (await todasCon('data-forma', 'redondeada')) && (await todasCon('data-ajuste', 'llenar')) && (await todasCon('data-fondo', 'gris')));
      await elegir('auto');
      anotar('Regresar a automático lo cambia en todas las pantallas', await todasVen('auto'));
      await degradar(b); await degradar(a);
    }

    // ── Chats: quién escribe, quién lee y qué NUNCA le llega a un participante ──
    {
      const leidos = (pagina: Page) => pagina.evaluate(() => [...document.querySelectorAll('[data-testid="chat-participante"] [data-testid="chat-mensaje"]')].map((e) => e.textContent ?? ''));
      const veTexto = async (pagina: Page, texto: string) => (await leidos(pagina)).some((t) => t.includes(texto));
      const enConsola = (texto: string) => `[...document.querySelectorAll('[data-testid="chat-consola"] [data-testid="chat-mensaje"]')].some((e) => (e.textContent || '').includes(${JSON.stringify(texto)}))`;
      const escribir = async (pagina: Page, texto: string) => { await pagina.click('[data-testid="chat-texto"]'); await pagina.type('[data-testid="chat-texto"]', texto); await pagina.keyboard.press('Enter'); };
      const idDe = (nombre: string) => consola.evaluate((n: string) => [...document.querySelectorAll('[data-testid="chat-para"] option')].find((o) => o.textContent === `Solo ${n}`)?.getAttribute('value') ?? '', nombre);

      for (const n of [a, b, c]) await clic(paginas[n], 'chat-barra');
      await escribir(paginas[a], 'No escucho bien');
      await esperar(consola, enConsola('No escucho bien'));
      anotar('El equipo recibe lo que escribe un participante', true);
      await dormir(800);
      anotar('Los demás participantes NO ven lo que escribió otro', !(await veTexto(paginas[b], 'No escucho bien')) && !(await veTexto(paginas[c], 'No escucho bien')));
      anotar('Quien lo escribió lo ve en su propio chat', await veTexto(paginas[a], 'No escucho bien'));

      // El equipo contesta SOLO a Ana.
      await consola.select('[data-testid="chat-para"]', await idDe(a));
      await escribir(consola, 'Ana, ya lo revisamos');
      await esperar(paginas[a], `[...document.querySelectorAll('[data-testid="chat-participante"] [data-testid="chat-mensaje"]')].some((e) => (e.textContent || '').includes('ya lo revisamos'))`);
      await dormir(800);
      anotar('Una respuesta a una persona solo la lee esa persona', !(await veTexto(paginas[b], 'ya lo revisamos')) && !(await veTexto(paginas[c], 'ya lo revisamos')));
      anotar('La respuesta privada le avisa que es solo para ella', (await leidos(paginas[a])).some((t) => t.includes('solo para ti')));

      // El equipo contesta a TODOS.
      await consola.select('[data-testid="chat-para"]', 'todos');
      await escribir(consola, 'Seguimos en cinco minutos');
      for (const n of [a, b, c]) await esperar(paginas[n], `[...document.querySelectorAll('[data-testid="chat-participante"] [data-testid="chat-mensaje"]')].some((e) => (e.textContent || '').includes('Seguimos en cinco'))`);
      anotar('Una respuesta a todos la leen todos', true);

      // El chat del equipo es interno: ningún participante lo ve, en ningún lugar de su pantalla.
      await clic(consola, 'chat-tab-equipo');
      await escribir(consola, 'nota interna del equipo');
      await esperar(consola, enConsola('nota interna del equipo'));
      await dormir(1200);
      const textoPantallas = await Promise.all([a, b, c].map((n) => paginas[n].evaluate(() => document.body.innerText)));
      anotar('El chat del equipo NUNCA llega a los participantes', textoPantallas.every((t) => !t.includes('nota interna del equipo')));
      await clic(consola, 'chat-tab-sesion');

      // Aviso de mensajes nuevos con el chat cerrado (también en la consola, con la otra pestaña).
      await clic(paginas[b], 'chat-barra'); // lo cierra
      await consola.select('[data-testid="chat-para"]', 'todos');
      await escribir(consola, 'Un último aviso');
      await esperar(paginas[b], JS.hay('[data-testid="chat-participante"] [data-testid="chat-nuevos"]'));
      anotar('Con el chat cerrado el participante ve «1 nuevo»', true);
      await clic(paginas[b], 'chat-barra');
      await esperar(paginas[b], JS.noHay('[data-testid="chat-participante"] [data-testid="chat-nuevos"]'));
      anotar('Al abrirlo el aviso desaparece', true);
      await clic(consola, 'chat-tab-equipo');
      await escribir(paginas[a], 'Otro mensaje de Ana'); // lo recibe la pestaña «Participantes» mientras se mira «Equipo»
      await esperar(consola, JS.hay('[data-testid="chat-tab-sesion"] [data-testid="chat-nuevos"]'));
      anotar('La consola avisa de mensajes nuevos en la otra pestaña', true);
      await clic(consola, 'chat-tab-sesion');

      // La consola no se mueve al cambiar de chat, y el backstage tiene el ancho del escenario.
      const medidas = () => consola.evaluate(() => {
        const b = document.querySelector('[data-testid="backstage"]')!.getBoundingClientRect();
        const e = document.querySelector('[data-testid="lista-escenario"]')!.getBoundingClientRect();
        const c = document.querySelector('[data-testid="chat-consola"]')!.getBoundingClientRect();
        return { arribaBackstage: Math.round(b.top), anchoBackstage: Math.round(b.width), anchoEscenario: Math.round(e.width), altoChat: Math.round(c.height) };
      });
      await clic(consola, 'chat-tab-sesion'); const m1 = await medidas();
      await clic(consola, 'chat-tab-verde'); const m2 = await medidas();
      await clic(consola, 'chat-tab-equipo'); const m3 = await medidas();
      await clic(consola, 'chat-tab-sesion');
      anotar('Cambiar de chat no mueve ni agranda nada: el backstage se queda en su lugar', [m2, m3].every((m) => m.arribaBackstage === m1.arribaBackstage && m.altoChat === m1.altoChat), JSON.stringify([m1, m2, m3]));
      anotar('El backstage tiene el mismo ancho que el escenario', Math.abs(m1.anchoBackstage - m1.anchoEscenario) <= 2, `${m1.anchoBackstage} px contra ${m1.anchoEscenario} px`);

      // Modo grupal: lo escrito ANTES sigue siendo privado y lo nuevo lo leen todos.
      await clic(consola, 'chat-interruptor-grupal'); await dormir(600);
      await escribir(paginas[a], 'Mensaje en modo grupal');
      await esperar(paginas[b], `[...document.querySelectorAll('[data-testid="chat-participante"] [data-testid="chat-mensaje"]')].some((e) => (e.textContent || '').includes('Mensaje en modo grupal'))`);
      anotar('En modo grupal los participantes se leen entre sí', true);
      anotar('Lo que se escribió ANTES del modo grupal sigue siendo privado', !(await veTexto(paginas[b], 'No escucho bien')));
      await clic(consola, 'chat-interruptor-grupal'); await dormir(600);
      await escribir(paginas[a], 'Otra vez solo equipo');
      await esperar(consola, enConsola('Otra vez solo equipo'));
      await dormir(800);
      anotar('Al volver a «solo con el equipo», lo nuevo ya no lo leen los demás', !(await veTexto(paginas[b], 'Otra vez solo equipo')));

      // Cerrar el chat de la sesión.
      await clic(consola, 'chat-interruptor-abierto');
      await esperar(paginas[b], JS.hay('[data-testid="chat-cerrado-aviso"]'));
      anotar('Con el chat cerrado el participante lo ve cerrado y no puede escribir', !(await paginas[b].$('[data-testid="chat-texto"]')));
      const rechazo = await paginas[b].evaluate(async () => {
        const k = Object.keys(sessionStorage).find((x) => x.startsWith('estudio:'))!;
        const pase = JSON.parse(sessionStorage.getItem(k)!).entrada.pase as string;
        const r = await fetch('/api/yo/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pase }, body: JSON.stringify({ texto: 'colado' }) });
        return r.status;
      });
      anotar('El servidor también rechaza escribir con el chat cerrado', rechazo >= 400 && rechazo < 500, `estado ${rechazo}`);
      await clic(consola, 'chat-interruptor-abierto');
      await esperar(paginas[b], JS.hay('[data-testid="chat-participante"]'));
      anotar('Al abrirlo otra vez el participante recupera su chat', true);

      // Sala verde: chat entre quien está ahí y el equipo; nadie más lo ve.
      await clic(consola, `verde-${c}`);
      await esperar(paginas[c], JS.lugar('verde'));
      await esperar(paginas[c], JS.hay('[data-testid="chat-barra"]'));
      await clic(paginas[c], 'chat-barra');
      await escribir(paginas[c], 'Aquí en la sala verde');
      await clic(consola, 'chat-tab-verde');
      await esperar(consola, enConsola('Aquí en la sala verde'));
      anotar('El equipo lee lo que escribe quien está en la sala verde', true);
      await escribir(consola, 'Te escucho bien, Carla');
      await esperar(paginas[c], `[...document.querySelectorAll('[data-testid="chat-participante"] [data-testid="chat-mensaje"]')].some((e) => (e.textContent || '').includes('Te escucho bien'))`);
      anotar('Quien está en la sala verde lee la respuesta del equipo', true);
      await dormir(700);
      anotar('Nadie más ve el chat de la sala verde', !(await veTexto(paginas[a], 'Aquí en la sala verde')) && !(await veTexto(paginas[b], 'Aquí en la sala verde')) && !(await veTexto(paginas[a], 'Te escucho bien')) && !(await veTexto(paginas[b], 'Te escucho bien')));
      await clic(consola, `pasar-${c}`);
      await esperar(paginas[c], JS.lugar('backstage'));
      await dormir(600);
      anotar('Al pasar a backstage ya no se ve el chat de la sala verde', !(await veTexto(paginas[c], 'Aquí en la sala verde')));
      await clic(consola, 'chat-tab-sesion');
      await consola.evaluate(() => { (document.querySelector('[data-testid="cerrar-diseno"]') as HTMLElement | null)?.click(); document.querySelector('[data-testid="chat-consola"]')?.scrollIntoView({ block: 'center' }); });
      await dormir(400);
      await foto(consola, '13-consola-con-chat'); await foto(paginas[a], '14-participante-con-chat');
    }

    // ── Vistas personales: Moderación conduce, Producción cuida lo que se ve (y no mueve a la gente) ──
    {
      const hay = async (sel: string) => !!(await consola.$(sel));
      await clic(consola, 'vista-produccion'); await dormir(500);
      anotar('En Producción el chat abre en «Equipo»', Boolean(await consola.evaluate(() => document.querySelector('[data-testid="chat-tab-equipo"]')?.getAttribute('aria-pressed') === 'true')));
      anotar('En Producción el lobby y la sala verde se reemplazan por un resumen de la gente', !(await hay('[data-testid="lista-lobby"]')) && !(await hay('[data-testid="lista-verde"]')) && (await hay('[data-testid="resumen-gente"]')));
      anotar('En Producción las viñetas de la gente son solo de ver (sin subir, bajar, silenciar ni mover)',
        !(await hay('[data-testid^="subir-"]')) && !(await hay('[data-testid^="bajar-"]')) && !(await hay('[data-testid^="silenciar-"]')) && !(await hay('[data-testid^="lobby-"]')) && !(await hay('[data-testid^="verde-"]')));
      anotar('En Producción siguen el escenario, el backstage con su gente y el selector de diseño', (await hay('[data-testid="lista-escenario"]')) && (await hay('[data-testid="backstage"] [data-testid^="mosaico-"]')) && (await hay('[data-testid="boton-diseno"]')));
      await foto(consola, '15-consola-produccion');
      await consola.reload();
      await esperar(consola, JS.hay('[data-testid="consola"]'));
      await dormir(1500);
      anotar('La vista elegida se recuerda al recargar', Boolean(await consola.evaluate(() => document.querySelector('[data-testid="vista-produccion"]')?.getAttribute('aria-pressed') === 'true')));
      await clic(consola, 'vista-moderacion'); await dormir(500);
      anotar('Al volver a Moderación regresan el lobby, la sala verde y las acciones sobre la gente', (await hay('[data-testid="lista-lobby"]')) && (await hay('[data-testid="lista-verde"]')) && (await hay('[data-testid^="subir-"]')) && (await hay('[data-testid^="lobby-"]')));
    }

    // ── EN VIVO: la página que se transmite (lo que LiveKit mandaría a Mux) solo muestra y escucha a quienes están en el escenario ──
    {
      // Sin llave de Mux no se puede empezar, y el aviso lo explica (esta sesión de prueba no tiene llave).
      await clic(consola, 'boton-envivo');
      await esperar(consola, JS.hay('[data-testid="aviso"]'));
      const avisoVivo = await consola.evaluate(() => document.querySelector('[data-testid="aviso"]')?.textContent ?? '');
      anotar('Sin llave de Mux el botón EN VIVO explica que falta', avisoVivo.includes('llave de transmisión'), avisoVivo);
      await consola.evaluate(() => (document.querySelector('[data-testid="aviso"]') as HTMLElement | null)?.click());

      await promover(a);
      await dormir(600);
      const API = 'http://localhost:8787/api';
      const cab = { 'content-type': 'application/json', 'x-equipo-email': EQUIPO.email, 'x-equipo-nombre': EQUIPO.nombre };
      const previa = await (await fetch(`${API}/sesiones/${creada.id}/grabadora/vista-previa`, { method: 'POST', headers: cab })).json() as { direccion: string };
      anotar('La vista previa entrega la dirección de la página que se transmite', previa.direccion.startsWith(`/grabadora/${creada.id}?t=`));
      const sinBoleto = await fetch(`${API}/grabadora/livekit`, { method: 'POST', headers: { authorization: 'Bearer boleto-inventado' } });
      anotar('Sin un boleto válido nadie obtiene el pase de la grabadora', sinBoleto.status >= 400 && sinBoleto.status < 500, `estado ${sinBoleto.status}`);

      const gra = await nuevaPantalla();
      await gra.setViewport({ width: 1920, height: 1080 });
      await gra.evaluateOnNewDocument('window.__TRAZA = true;'); // deja la sala a la vista de la prueba
      let senal = false;
      gra.on('console', (m) => { if (m.text() === 'START_RECORDING') senal = true; });
      await gra.goto(`${WEB}${previa.direccion}`);
      await esperar(gra, JS.hay('[data-testid="grabadora"] [data-testid="mosaico-Ana"] video'), null, 20000);
      anotar('La página que se transmite dibuja a quien está en el escenario', true);
      for (let i = 0; i < 100 && !senal; i++) await dormir(100);
      anotar('La página avisa «START_RECORDING» cuando ya conectó (LiveKit espera esa señal para empezar)', senal);
      const sesionOculta = await gra.evaluate(() => { const r = (window as unknown as { __sala?: { remoteParticipants: Map<string, unknown>; localParticipant: { permissions?: { hidden?: boolean; canPublish?: boolean } } } }).__sala; return r ? { hidden: !!r.localParticipant.permissions?.hidden, publica: !!r.localParticipant.permissions?.canPublish } : null; });
      anotar('La grabadora entra oculta y sin poder publicar', !!sesionOculta && sesionOculta.hidden && !sesionOculta.publica, JSON.stringify(sesionOculta));

      // PRIVACIDAD: nadie que no esté en el escenario aparece ni se escucha.
      const texto = await gra.evaluate(() => document.body.innerText);
      const enPagina = await gra.evaluate((nombres: string[]) => nombres.filter((n) => !!document.querySelector(`[data-testid="mosaico-${n}"]`)), [b, c]);
      anotar('La página NO muestra a quienes están en backstage', enPagina.length === 0 && !texto.includes(b) && !texto.includes(c), JSON.stringify(enPagina));
      const audios = await gra.evaluate(() => document.querySelectorAll('audio').length);
      const enEscenaAhora = await consola.evaluate(() => document.querySelectorAll('[data-testid="lista-escenario"] [data-testid^="mosaico-"]').length);
      anotar('La página solo reproduce el sonido de quienes están en el escenario', audios <= enEscenaAhora, `${audios} sonidos, ${enEscenaAhora} en el escenario`);

      // Lo que se emite sigue al escenario: sube Beto, aparece; baja, desaparece.
      await promover(b);
      await esperar(gra, JS.hay(`[data-testid="grabadora"] [data-testid="mosaico-${b}"]`), null, 10000);
      anotar(`Si sube ${b} al escenario, aparece en lo que se transmite`, true);
      await degradar(b);
      await esperar(gra, JS.noHay(`[data-testid="grabadora"] [data-testid="mosaico-${b}"]`), null, 10000);
      anotar(`Si baja ${b}, desaparece de lo que se transmite (y de su sonido)`, true);

      // El diseño elegido en la consola es el que sale al aire.
      await consola.evaluate(() => { const x = document.querySelector('[data-testid="boton-diseno"]') as HTMLElement | null; if (x && !document.querySelector('[data-testid="diseno-foco"]')) x.click(); });
      await dormir(300);
      await clic(consola, 'diseno-foco'); await clic(consola, 'forma-circulo'); await clic(consola, 'fondo-negro');
      await esperar(gra, `document.querySelector('[data-testid="escena-grabadora"]')?.getAttribute('data-diseno') === 'foco' && document.querySelector('[data-testid="escena-grabadora"]')?.getAttribute('data-fondo') === 'negro'`, null, 10000);
      anotar('El diseño, la forma y el fondo elegidos son los que se transmiten', true);
      await foto(gra, '16-lo-que-sale-al-aire');
      await clic(consola, 'diseno-auto'); await clic(consola, 'forma-redondeada'); await clic(consola, 'fondo-gris'); await dormir(500);
      await consola.evaluate(() => (document.querySelector('[data-testid="cerrar-diseno"]') as HTMLElement | null)?.click());
      await gra.close();
      await degradar(a);
    }

    // ── Highlights: un clic marca el momento, se titula a mano, se borra y se exporta; solo el equipo los ve ──
    {
      const aceptar = (d: { accept: () => Promise<void> }) => void d.accept().catch(() => undefined);
      consola.on('dialog', aceptar);
      const lista = () => consola.evaluate("[...document.querySelectorAll('[data-testid=\"panel-highlights\"] [data-testid=\"highlight\"]')].map((e) => ({ minuto: (e.querySelector('[data-testid=\"highlight-minuto\"]') || {}).textContent, titulo: (e.querySelector('[data-testid=\"highlight-titulo\"]') || {}).value }))") as Promise<{ minuto: string; titulo: string }[]>;
      const cuenta = async () => (await lista()).length;
      const esperarCuenta = async (n: number) => { for (let i = 0; i < 50 && (await cuenta()) !== n; i++) await dormir(100); return (await cuenta()) === n; };
      const base = await cuenta();

      await clic(consola, 'boton-highlight'); await dormir(300); await clic(consola, 'boton-highlight');
      anotar('Un clic en «Highlight» marca el momento y aparece en la lista', await esperarCuenta(base + 2));
      const primero = (await lista())[0]!;
      anotar('Sin estar al aire dice que se marcó «sin EN VIVO» y guarda la hora', /^\d{2}:\d{2}:\d{2}$/.test(primero.minuto), primero.minuto);

      await consola.evaluate("document.activeElement && document.activeElement.blur()");
      await consola.keyboard.press('h');
      anotar('La tecla H también marca el momento', await esperarCuenta(base + 3));
      await consola.click('[data-testid="chat-texto"]');
      await consola.keyboard.type('hola, hay que hablar de la H');
      await dormir(500);
      anotar('Escribiendo en un cuadro de texto, la H es una letra y no marca nada', (await cuenta()) === base + 3);
      await consola.evaluate("document.activeElement && document.activeElement.blur()");

      // Título a mano: se guarda al terminar y sobrevive a recargar.
      await consola.click('[data-testid="panel-highlights"] [data-testid="highlight-titulo"]');
      await consola.keyboard.type('Cita sobre el precio');
      await consola.keyboard.press('Enter');
      await dormir(800);
      await consola.reload();
      await esperar(consola, JS.hay('[data-testid="consola"]'));
      await dormir(1500);
      anotar('El título puesto a mano se guarda y sigue ahí al recargar', (await lista()).some((h) => h.titulo === 'Cita sobre el precio'));

      // Los participantes NUNCA ven los highlights, ni su título.
      const pantallas = await Promise.all([a, b, c].map((n) => paginas[n].evaluate(() => document.body.innerText)));
      anotar('Ningún participante ve los highlights ni sus títulos', pantallas.every((t) => !t.includes('Cita sobre el precio') && !t.includes('Highlight')));

      // Exportar: se captura el archivo que se descargaría.
      await consola.evaluate("window.__csv = ''; window.__bom = false; const original = URL.createObjectURL.bind(URL); URL.createObjectURL = (blob) => { blob.arrayBuffer().then((b) => { const u = new Uint8Array(b); window.__bom = u[0] === 239 && u[1] === 187 && u[2] === 191; window.__csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(b); }); return original(blob); };");
      await clic(consola, 'highlights-exportar');
      for (let i = 0; i < 30 && !(await consola.evaluate("window.__csv")); i++) await dormir(100);
      const csv = String(await consola.evaluate("window.__csv"));
      const conMarca = Boolean(await consola.evaluate('window.__bom'));
      anotar('Exportar baja un CSV con la marca de Excel, encabezados, los títulos y quién marcó', conMarca && csv.replace(/^\ufeff/, '').startsWith('Número,Minuto de la grabación,Hora,Título,Marcó') && csv.includes('Cita sobre el precio') && csv.includes('Marina'), `${csv.split('\r\n').length - 1} filas, marca ${conMarca}`);

      // Borrar.
      await clic(consola, 'highlight-borrar');
      anotar('Borrar quita ese highlight', await esperarCuenta(base + 2));
      consola.off('dialog', aceptar);
    }

    // ── Regresar al lobby ──
    {
      const t0 = ahora();
      await clic(consola, `lobby-${c}`);
      await esperar(paginas[c], JS.lugar('lobby'));
      await esperar(consola, JS.enSeccion('lista-lobby', c));
      anotar(`Regresar a ${c} al lobby`, true, `${Math.round(ahora() - t0)} ms`);
      anotar(`En el lobby ${c} no tiene chat`, !(await paginas[c].$('[data-testid="chat-participante"]')));
    }

    // ── Desconexiones: la viñeta se apaga con aviso, se puede mover aunque esté desconectada, y si no regresa el servidor la manda al lobby ──
    {
      const enBackstage = (q: string) => `!!document.querySelector('[data-testid="lista-backstage"] [data-testid="mosaico-${q}"]')`;
      const aBackstage = async (nombre: string) => {
        const pg = await entrarComo(nombre);
        await esperar(consola, JS.enSeccion('lista-lobby', nombre));
        await clic(consola, `llamar-${nombre}`); await esperar(pg, JS.lugar('verde'));
        await clic(consola, `pasar-${nombre}`); await esperar(consola, JS.enSeccion('lista-backstage', nombre));
        return pg;
      };
      // Todos los de backstage se ven opacos (velo claro).
      const velos = Boolean(await consola.evaluate(() => { const t = [...document.querySelectorAll('[data-testid^="tarjeta-backstage-"]')]; return t.length > 0 && t.every((x) => !!x.querySelector('.bg-white\\/55')); }));
      anotar('Todas las viñetas de backstage se ven opacas (y hay al menos una)', velos);
      await foto(consola, '12-backstage-opaco');

      // Dora se desconecta y se le manda al lobby durante el plazo (antes el cambio se cancelaba y volvía a backstage).
      const dora = await aBackstage('Dora');
      await dora.close();
      await esperar(consola, `document.querySelector('[data-testid="tarjeta-backstage-Dora"]')?.innerText.includes('Sin conexión')`, null, 20000);
      anotar('Al desconectarse, su viñeta de backstage dice «Sin conexión»', true);
      await dormir(6000); // para que LiveKit ya no la encuentre
      await clic(consola, 'lobby-Dora');
      await esperar(consola, JS.noHay('[data-testid="lista-backstage"] [data-testid="mosaico-Dora"]'), null, 8000);
      await dormir(3000);
      const vuelve = await consola.evaluate(enBackstage('Dora'));
      const aviso = await consola.evaluate(() => document.querySelector('[data-testid="aviso"]')?.textContent ?? '');
      anotar('Mandar al lobby a alguien desconectado funciona y no vuelve a backstage', !vuelve, aviso ? `aviso: ${aviso}` : '');
      const enListaLobby = await consola.evaluate(() => !!document.querySelector('[data-testid="fila-lobby-Dora"]'));
      anotar('Quien está en el lobby sin conexión no aparece en la lista', !enListaLobby);

      // Eva se desconecta y nadie la mueve: pasado el plazo desaparece sola de backstage.
      const eva = await aBackstage('Eva');
      await eva.close();
      const t0 = ahora();
      await esperar(consola, `document.querySelector('[data-testid="tarjeta-backstage-Eva"]')?.innerText.includes('Sin conexión')`, null, 20000);
      await dormir(4000);
      anotar('Al desconectarse sigue unos segundos en backstage (las redes flojas se reconectan solas)', Boolean(await consola.evaluate(enBackstage('Eva'))));
      await esperar(consola, JS.noHay('[data-testid="lista-backstage"] [data-testid="mosaico-Eva"]'), null, 60000);
      const seFue = Math.round((ahora() - t0) / 1000);
      anotar('Si no regresa, desaparece sola de backstage', true, `${seFue} s`);
      const enLobbyVisible = await consola.evaluate(() => !!document.querySelector('[data-testid="fila-lobby-Eva"]'));
      anotar('Y tampoco aparece en el lobby mientras siga sin conexión', !enLobbyVisible);
    }

    // ── Terminar ──
    consola.on('dialog', (d) => void d.accept());
    await clic(consola, 'terminar');
    await Promise.all(NOMBRES.map((n) => esperar(paginas[n], JS.texto('La sesión terminó'))));
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
