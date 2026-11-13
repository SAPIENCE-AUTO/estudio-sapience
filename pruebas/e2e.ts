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
    for (const nombre of NOMBRES) {
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
      paginas[nombre] = p;
    }
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

    // ── Regresar al lobby ──
    {
      const t0 = ahora();
      await clic(consola, `lobby-${c}`);
      await esperar(paginas[c], JS.lugar('lobby'));
      await esperar(consola, JS.enSeccion('lista-lobby', c));
      anotar(`Regresar a ${c} al lobby`, true, `${Math.round(ahora() - t0)} ms`);
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
