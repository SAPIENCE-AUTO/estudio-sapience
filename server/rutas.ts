import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from './config';
import { ErrorDominio, idMiembro } from './dominio';
import { PersonaDesconectada } from './livekit';
import { buzonDePasesHub, equipoDesdeSolicitud, ErrorAcceso, esLlaveDelHub, firmarBoleto, firmarSesionEquipo, leerGrabadora, pasePorEncabezado, type DatosPase, type UsuarioEquipo } from './auth';
import { destinoDeSesion, ID_SESION, TTL_PASE_HUB_MS, TTL_SESION_EQUIPO_MS } from './accesoHub';
import { nombreDeCorreo } from './acceso';
import * as servicio from './servicio';
import type { Sesion } from './dominio';
import { AJUSTES_DISENO, FONDOS_DISENO, FORMAS_DISENO, MODOS_PANTALLA, TIPOS_DISENO } from '../compartido/tipos';

type ConEquipo = Request & { equipo?: UsuarioEquipo };
type ConPase = Request & { pase?: DatosPase };

const ruta = (f: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(f(req, res)).catch(next);

async function exigirEquipo(req: ConEquipo, _res: Response, next: NextFunction) {
  try { req.equipo = await equipoDesdeSolicitud(req); next(); } catch (e) { next(e); }
}

function exigirPase(req: ConPase, _res: Response, next: NextFunction) {
  const p = pasePorEncabezado(req);
  if (!p) return next(new ErrorDominio('NO_PERMITIDO', 'Tu pase venció o no es válido'));
  req.pase = p;
  next();
}

const linksDeSesion = (s: { id: string; codigo: string }) => ({
  linkParticipantes: `${config.URL_PUBLICA}/p/${s.codigo}`,
  linkEquipo: `${config.URL_PUBLICA}/equipo/${s.id}`,
});

export function crearRutas(): express.Router {
  const r = express.Router();

  // --- Datos públicos para que la pantalla sepa cómo entra el equipo (la llave «anon» de Supabase es pública por diseño) ---
  r.get('/config-publica', (_req, res) => {
    res.set('cache-control', 'no-store');
    res.json(config.AUTH_MODE === 'supabase'
      ? { authMode: 'supabase', supabaseUrl: config.SUPABASE_URL, supabaseAnonKey: config.SUPABASE_ANON_KEY }
      : { authMode: 'dev' });
  });

  // Quién soy: la pantalla lo usa al entrar para saber si ese correo tiene acceso.
  r.get('/equipo/yo', exigirEquipo, (req: ConEquipo, res) => {
    res.set('cache-control', 'no-store');
    res.json(req.equipo);
  });

  // --- Acceso directo desde el Hub: quien ya entró al Hub no vuelve a pedir su correo ---
  // 1) El Hub (SOLO con su llave, nunca un usuario) pide un pase de un solo uso para el correo de quien aprieta «Abrir en Talks».
  //    El correo lo pone el servidor del Hub con la sesión que ya verificó, no el navegador. El Hub responde por sus usuarios
  //    (solo entran los dados de alta en su tabla): aquí NO hay otra lista que mantener (EQUIPO_PERMITIDO es solo para entrar directo con el correo).
  r.post('/v1/acceso-equipo', ruta(async (req, res) => {
    if (!esLlaveDelHub(req)) throw new ErrorAcceso(401, 'NO_AUTENTICADO', 'Falta la llave del Hub');
    const { email, nombre, sesionId } = z.object({
      email: z.string().trim().email().max(200),
      nombre: z.string().trim().max(60).optional(),
      sesionId: z.string().regex(ID_SESION).optional(),
    }).parse(req.body);
    const correo = email.toLowerCase();
    if (sesionId && !servicio.sesionPorId(sesionId)) throw new ErrorDominio('NO_ENCONTRADO', 'Esa sesión no existe');
    const codigo = buzonDePasesHub.emitir({ email: correo, nombre: nombre || nombreDeCorreo(correo), destino: destinoDeSesion(sesionId) });
    res.set('cache-control', 'no-store');
    // El pase va en la parte «#» de la dirección: esa parte no llega a ningún servidor, ni a los registros, ni al «referer».
    res.status(201).json({ url: `${config.URL_PUBLICA}/entrar-hub#c=${codigo}`, venceEnSegundos: TTL_PASE_HUB_MS / 1000 });
  }));

  // 2) La pantalla de Talks cambia el pase por una sesión del equipo. Es pública a propósito: el pase es el secreto (256 bits, un solo uso, 60 s).
  r.post('/equipo/canjear', ruta(async (req, res) => {
    res.set('cache-control', 'no-store');
    const { codigo } = z.object({ codigo: z.string().min(8).max(200) }).parse(req.body);
    const d = buzonDePasesHub.canjear(codigo);
    if (!d) throw new ErrorAcceso(401, 'NO_AUTENTICADO', 'Este acceso ya se usó o venció. Ábrelo otra vez desde el Hub');
    const usuario = { email: d.email, nombre: d.nombre };
    res.json({ token: firmarSesionEquipo(usuario), ...usuario, destino: d.destino, venceEn: Date.now() + TTL_SESION_EQUIPO_MS });
  }));

  // --- Para el Hub (llave) y para el equipo: crear una sesión ---
  // Lo que se devuelve de una sesión creada desde fuera. NUNCA incluye la llave de Mux: solo dice si hay o no una configurada.
  const respuestaDeCreacion = (s: Sesion, yaExistia: boolean) => ({
    id: s.id, nombre: s.nombre, codigo: s.codigo, ...linksDeSesion(s), externoId: s.externoId ?? null, yaExistia,
    transmision: s.muxLlave ? 'lista' : 'sin-llave',
  });

  // El Hub crea la sesión de un evento del calendario (con su llave de Mux). Apretar el botón dos veces devuelve la misma.
  r.post('/v1/sesiones', ruta(async (req, res) => {
    if (!esLlaveDelHub(req)) await equipoDesdeSolicitud(req); // lanza ErrorAcceso si tampoco es del equipo
    const { nombre, externoId, muxStreamKey, observacionUrl } = z.object({
      nombre: z.string().min(1).max(120),
      externoId: z.string().min(1).max(120).optional(),
      // Las llaves de Mux son letras, números y guiones; se valida porque va dentro de una dirección de transmisión.
      muxStreamKey: z.string().regex(/^[A-Za-z0-9-]{8,100}$/, 'La llave de transmisión no tiene el formato de Mux').optional(),
      observacionUrl: z.string().url().max(500).startsWith('https://').optional(),
    }).parse(req.body);
    const { sesion, yaExistia } = servicio.crearSesion(nombre, { externoId, muxLlave: muxStreamKey, observacionUrl });
    res.status(yaExistia ? 200 : 201).json(respuestaDeCreacion(sesion, yaExistia));
  }));

  // Los links de la sesión de un evento (el Hub los muestra cuando ya se crearon).
  r.get('/v1/sesiones/evento/:externoId', ruta(async (req, res) => {
    if (!esLlaveDelHub(req)) await equipoDesdeSolicitud(req);
    const s = servicio.sesionDelEvento(req.params.externoId as string);
    if (!s) throw new ErrorDominio('NO_ENCONTRADO', 'Ese evento todavía no tiene sesión en Talks');
    res.json(respuestaDeCreacion(s, true));
  }));

  // --- Equipo ---
  r.get('/sesiones', exigirEquipo, ruta(async (_req, res) => {
    res.json(servicio.listarSesiones().map((s) => ({
      id: s.id, nombre: s.nombre, codigo: s.codigo, terminada: s.terminada, creadaEn: s.creadaEn, ...linksDeSesion(s),
      participantes: Object.keys(s.participantes).length,
    })));
  }));

  r.post('/sesiones/:sid/participantes/:pid/silenciar', exigirEquipo, ruta(async (req, res) => {
    const { silenciado } = z.object({ silenciado: z.boolean() }).parse(req.body);
    res.json(await servicio.silenciar(req.params.sid as string, req.params.pid as string, silenciado));
  }));

  const acciones = {
    llamar: (sid: string, pid: string, eq: string) => servicio.llamar(sid, pid, eq),
    pasar: (sid: string, pid: string) => servicio.pasarASesion(sid, pid),
    lobby: (sid: string, pid: string) => servicio.regresarALobby(sid, pid),
    subir: (sid: string, pid: string) => servicio.subir(sid, pid),
    bajar: (sid: string, pid: string) => servicio.bajar(sid, pid),
  } as const;

  r.post('/sesiones/:sid/participantes/:pid/:accion', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const { sid, pid, accion } = req.params as { sid: string; pid: string; accion: keyof typeof acciones };
    if (!(accion in acciones)) throw new ErrorDominio('NO_ENCONTRADO', 'Acción desconocida');
    const eq = idMiembro(req.equipo!.email);
    res.json(await acciones[accion](sid, pid, eq));
  }));

  r.post('/sesiones/:sid/equipo/token', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const { sid } = req.params as { sid: string };
    const u = req.equipo!;
    await servicio.unirseEquipo(sid, u.email, u.nombre);
    res.json(await servicio.tokenParaEquipo(sid, idMiembro(u.email)));
  }));

  // Boleto para abrir el canal en vivo (WebSocket): vale 60 segundos y solo para esta sesión.
  r.post('/sesiones/:sid/equipo/boleto', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const sid = req.params.sid as string;
    if (!servicio.sesionPorId(sid)) throw new ErrorDominio('NO_ENCONTRADO', 'Esa sesión no existe');
    const u = req.equipo!;
    res.json({ boleto: firmarBoleto({ sid, email: u.email, nombre: u.nombre }) });
  }));

  // Pantalla compartida del equipo: empezar (nace en backstage), subirla al escenario o regresarla, y dejar de compartir. Una a la vez.
  r.post('/sesiones/:sid/pantalla', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const sid = req.params.sid as string;
    const eq = idMiembro(req.equipo!.email);
    const cuerpo = z.discriminatedUnion('accion', [
      z.object({ accion: z.literal('empezar'), modo: z.enum(MODOS_PANTALLA as [string, ...string[]]), audio: z.boolean() }),
      z.object({ accion: z.literal('detener') }),
      z.object({ accion: z.literal('escenario'), enEscenario: z.boolean() }),
    ]).parse(req.body);
    if (cuerpo.accion === 'empezar') return res.json(await servicio.empezarPantalla(sid, eq, cuerpo.modo as 'presentacion' | 'video', cuerpo.audio));
    if (cuerpo.accion === 'detener') return res.json(await servicio.detenerPantalla(sid, eq));
    return res.json(await servicio.pantallaEnEscenario(sid, eq, cuerpo.enEscenario));
  }));

  r.post('/sesiones/:sid/equipo/escenario', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const { enEscenario } = z.object({ enEscenario: z.boolean() }).parse(req.body);
    res.json(await servicio.ponerEnEscenario(req.params.sid as string, idMiembro(req.equipo!.email), enEscenario));
  }));

  // Highlights: un clic marca el momento; el título se pone a mano (después, con IA); se pueden borrar.
  r.post('/sesiones/:sid/highlights', exigirEquipo, ruta(async (req: ConEquipo, res) => { res.json(await servicio.marcarHighlight(req.params.sid as string, idMiembro(req.equipo!.email))); }));
  r.post('/sesiones/:sid/highlights/:id/titulo', exigirEquipo, ruta(async (req, res) => {
    const { titulo } = z.object({ titulo: z.string().max(400) }).parse(req.body);
    res.json(await servicio.titularHighlight(req.params.sid as string, req.params.id as string, titulo));
  }));
  r.post('/sesiones/:sid/highlights/:id/borrar', exigirEquipo, ruta(async (req, res) => { res.json(await servicio.borrarHighlight(req.params.sid as string, req.params.id as string)); }));

  // EN VIVO: empezar y terminar la transmisión a la sala de observación (Mux).
  r.post('/sesiones/:sid/envivo/iniciar', exigirEquipo, ruta(async (req, res) => { res.json(await servicio.iniciarEnVivo(req.params.sid as string)); }));
  r.post('/sesiones/:sid/envivo/detener', exigirEquipo, ruta(async (req, res) => { res.json(await servicio.detenerEnVivo(req.params.sid as string)); }));
  // Vista previa de lo que sale al aire: la misma página que transmite LiveKit, para abrirla en otra pestaña.
  r.post('/sesiones/:sid/grabadora/vista-previa', exigirEquipo, ruta(async (req, res) => { res.json({ direccion: servicio.direccionDeVistaPrevia(req.params.sid as string) }); }));
  // La página que se transmite pide aquí su pase de LiveKit, con el boleto de la grabadora.
  r.post('/grabadora/livekit', ruta(async (req, res) => {
    const g = leerGrabadora((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!g) throw new ErrorDominio('NO_PERMITIDO', 'El boleto de la transmisión venció o no es válido');
    res.json(await servicio.livekitDeGrabadora(g.sid));
  }));

  r.post('/sesiones/:sid/chat/config', exigirEquipo, ruta(async (req, res) => {
    const cfg = z.object({ abierto: z.boolean(), grupal: z.boolean() }).parse(req.body);
    res.json(await servicio.ponerChat(req.params.sid as string, cfg));
  }));

  r.post('/sesiones/:sid/chat', exigirEquipo, ruta(async (req: ConEquipo, res) => {
    const { canal, texto, para } = z.object({ canal: z.enum(['equipo', 'verde', 'sesion']), texto: z.string().max(2000), para: z.string().max(40).default('todos') }).parse(req.body);
    res.json(await servicio.mensajeDelEquipo(req.params.sid as string, idMiembro(req.equipo!.email), canal, texto, para));
  }));

  r.post('/sesiones/:sid/diseno', exigirEquipo, ruta(async (req, res) => {
    const diseno = z.object({
      tipo: z.enum(TIPOS_DISENO), fijado: z.string().nullable(), forma: z.enum(FORMAS_DISENO), ajuste: z.enum(AJUSTES_DISENO), fondo: z.enum(FONDOS_DISENO),
    }).parse(req.body);
    res.json(await servicio.ponerDiseno(req.params.sid as string, diseno));
  }));

  r.post('/sesiones/:sid/terminar', exigirEquipo, ruta(async (req, res) => {
    res.json(await servicio.terminar(req.params.sid as string));
  }));

  // --- Participantes (link único) ---
  r.get('/p/:codigo', ruta(async (req, res) => {
    const s = servicio.sesionPorCodigo(req.params.codigo as string);
    if (!s || s.terminada) throw new ErrorDominio('NO_ENCONTRADO', 'Ese link no es válido o la sesión ya terminó');
    res.json({ nombre: s.nombre });
  }));

  r.post('/p/:codigo/entrar', ruta(async (req, res) => {
    const { nombre } = z.object({ nombre: z.string().min(1).max(60), aceptoAviso: z.literal(true, { error: 'Acepta el aviso de privacidad para entrar' }) }).parse(req.body);
    res.json(await servicio.entrarParticipante(req.params.codigo as string, nombre));
  }));

  r.post('/yo/livekit', exigirPase, ruta(async (req: ConPase, res) => {
    res.json(await servicio.livekitDeParticipante(req.pase!.sid, req.pase!.pid));
  }));

  r.post('/yo/chat', exigirPase, ruta(async (req: ConPase, res) => {
    const { texto } = z.object({ texto: z.string().max(2000) }).parse(req.body);
    res.json(await servicio.mensajeDeParticipante(req.pase!.sid, req.pase!.pid, texto));
  }));

  // Salir por voluntad propia (botón «Salir» del participante): regresa al lobby y se marca DESCONECTADO al instante. Si no, la persona se vería en el
  // lobby de la consola (con su botón «Llamar») los ~4 s que el canal espera antes de dar por desconectado a alguien que cerró la pestaña.
  r.post('/yo/salir', exigirPase, ruta(async (req: ConPase, res) => {
    const { sid, pid } = req.pase!;
    const resultado = await servicio.regresarALobby(sid, pid);
    await servicio.conexion(sid, { participanteId: pid }, false);
    res.json(resultado);
  }));

  return r;
}

// Errores: las reglas del dominio y los datos mal formados salen con un mensaje claro; lo demás se registra y sale genérico.
export function manejarErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ErrorAcceso) return res.status(err.estado).json({ error: err.codigo, mensaje: err.message });
  if (err instanceof ErrorDominio) {
    const estado = err.codigo === 'NO_ENCONTRADO' ? 404 : err.codigo === 'SESION_TERMINADA' ? 410 : 409;
    return res.status(estado).json({ error: err.codigo, mensaje: err.message });
  }
  if (err instanceof PersonaDesconectada) return res.status(409).json({ error: 'DESCONECTADO', mensaje: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'DATOS_INVALIDOS', mensaje: 'Datos inválidos' });
  console.error('Error no esperado:', err);
  res.status(500).json({ error: 'INTERNO', mensaje: 'Algo salió mal' });
}
