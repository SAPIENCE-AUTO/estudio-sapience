// Reglas de la sesión, sin red ni LiveKit: quién puede estar dónde y cómo se mueve.
// Todo lo que cambia el estado sube la versión. Las acciones repetidas no cambian nada (así un doble clic no estorba).
import { randomBytes, createHash } from 'node:crypto';
import { AJUSTES_DISENO, FONDOS_DISENO, FORMAS_DISENO, MAX_TEXTO_CHAT, MAX_TITULO_HIGHLIGHT, TIPOS_DISENO, normalizarChat, normalizarDiseno, type CanalChat, type ConfigChat, type Diseno, type Lugar } from '../compartido/tipos';

export class ErrorDominio extends Error {
  constructor(public codigo: 'NO_ENCONTRADO' | 'NO_PERMITIDO' | 'SESION_TERMINADA', mensaje: string) {
    super(mensaje);
  }
}

export interface Participante {
  id: string;
  nombre: string;
  lugar: Lugar;
  verdeCon: string | null;
  conectado: boolean;
  entroEn: number;
  /** Cuándo aceptó el aviso de privacidad (entrar exige aceptarlo). Ausente en sesiones guardadas antes de que existiera. */
  avisoEn?: number;
  /** El equipo le quitó el micrófono (en LiveKit se le retira el permiso de publicar audio). */
  silenciado?: boolean;
}

export interface Miembro {
  id: string;
  nombre: string;
  email: string;
  enEscenario: boolean;
  conectado: boolean;
}

export interface Mensaje {
  id: string;
  canal: CanalChat;
  deId: string;
  deNombre: string;
  deRol: 'equipo' | 'participante';
  /** 'equipo' (lo escribió un participante), 'todos' o el id de un participante. */
  para: string;
  texto: string;
  en: number;
  /** Solo en el chat de la sesión: si lo escribió un participante cuando el chat estaba en modo grupal (se decide AL ESCRIBIR, nunca después). */
  grupal?: boolean;
}

export interface Highlight {
  id: string;
  en: number;
  vivoDesde: number | null;
  titulo: string;
  porNombre: string;
}

export interface Sesion {
  /** Momentos marcados por el equipo (los últimos 500). Nunca llegan a los participantes. */
  highlights?: Highlight[];
  /** La transmisión en curso (en LiveKit: el egress que manda el escenario a Mux). Ausente si no se está transmitiendo. */
  envivo?: { egressId: string; desde: number };
  /** Identificador del evento del calendario del Hub al que pertenece esta sesión (una sesión por evento). */
  externoId?: string;
  /**
   * Llave de transmisión de Mux de la sala de observación (la ÚNICA credencial que permite transmitir ahí). Solo el servidor la usa:
   * NUNCA va en el estado que reciben las pantallas, ni en ninguna respuesta, ni en los registros.
   */
  muxLlave?: string;
  /** Página de observación del cliente (en el Hub), solo para mostrarla. */
  observacionUrl?: string;
  /** Cómo está el chat de la sesión. Ausente en sesiones guardadas antes de que existiera (= abierto, solo con el equipo). */
  chat?: ConfigChat;
  /** Mensajes de los chats (los últimos MAX_MENSAJES). Ausente en sesiones guardadas antes de que existieran. */
  mensajes?: Mensaje[];
  /** Diseño del escenario. Ausente en sesiones guardadas antes de que existiera (= automático). */
  diseno?: Diseno;
  id: string;
  nombre: string;
  /** Código del link único de los participantes. */
  codigo: string;
  creadaEn: number;
  terminada: boolean;
  version: number;
  participantes: Record<string, Participante>;
  equipo: Record<string, Miembro>;
}

const aleatorio = (bytes: number) => randomBytes(bytes).toString('hex');

export interface DatosExternos { externoId?: string; muxLlave?: string; observacionUrl?: string }

export function nuevaSesion(nombre: string, ahora = Date.now(), externos: DatosExternos = {}): Sesion {
  const s: Sesion = {
    id: 's' + aleatorio(5), nombre: nombre.trim().slice(0, 120) || 'Sesión sin nombre',
    codigo: aleatorio(6), creadaEn: ahora, terminada: false, version: 1, participantes: {}, equipo: {},
  };
  if (externos.externoId) s.externoId = externos.externoId;
  if (externos.muxLlave) s.muxLlave = externos.muxLlave;
  if (externos.observacionUrl) s.observacionUrl = externos.observacionUrl;
  return s;
}

/** La sesión VIVA que corresponde a un evento del Hub (la más reciente), si existe. Una terminada no cuenta: el evento puede volver a empezar. */
export function sesionDelEvento(sesiones: Record<string, Sesion>, externoId: string): Sesion | undefined {
  return Object.values(sesiones).filter((s) => s.externoId === externoId && !s.terminada).sort((a, b) => b.creadaEn - a.creadaEn)[0];
}

/**
 * Crea la sesión de un evento, o devuelve la que ya existe (apretar el botón del Hub dos veces no crea dos). Si el Hub manda una llave
 * o un nombre distinto (la regeneró o renombró el evento), se actualiza. Sin `externoId` siempre crea una nueva.
 */
export function crearOActualizar(sesiones: Record<string, Sesion>, nombre: string, externos: DatosExternos = {}, ahora = Date.now()): { sesion: Sesion; yaExistia: boolean; cambio: boolean } {
  const existente = externos.externoId ? sesionDelEvento(sesiones, externos.externoId) : undefined;
  if (!existente) {
    const sesion = nuevaSesion(nombre, ahora, externos);
    sesiones[sesion.id] = sesion;
    return { sesion, yaExistia: false, cambio: true };
  }
  let cambio = false;
  const limpio = nombre.trim().slice(0, 120);
  if (limpio && limpio !== existente.nombre) { existente.nombre = limpio; cambio = true; }
  if (externos.muxLlave && externos.muxLlave !== existente.muxLlave) { existente.muxLlave = externos.muxLlave; cambio = true; }
  if (externos.observacionUrl && externos.observacionUrl !== existente.observacionUrl) { existente.observacionUrl = externos.observacionUrl; cambio = true; }
  if (cambio) sube(existente);
  return { sesion: existente, yaExistia: true, cambio };
}

function viva(s: Sesion) {
  if (s.terminada) throw new ErrorDominio('SESION_TERMINADA', 'La sesión ya terminó');
}
function participante(s: Sesion, id: string): Participante {
  const p = s.participantes[id];
  if (!p) throw new ErrorDominio('NO_ENCONTRADO', 'Esa persona no está en la sesión');
  return p;
}
function miembro(s: Sesion, id: string): Miembro {
  const m = s.equipo[id];
  if (!m) throw new ErrorDominio('NO_ENCONTRADO', 'Ese miembro del equipo no está en la sesión');
  return m;
}
const sube = (s: Sesion) => { s.version += 1; };

/** Un participante entra por el link único con el nombre que escribió. Cae en el lobby. */
export function entrar(s: Sesion, nombre: string, ahora = Date.now()): Participante {
  viva(s);
  const limpio = nombre.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!limpio) throw new ErrorDominio('NO_PERMITIDO', 'Escribe tu nombre');
  const p: Participante = { id: 'p_' + aleatorio(4), nombre: limpio, lugar: 'lobby', verdeCon: null, conectado: false, entroEn: ahora, avisoEn: ahora };
  s.participantes[p.id] = p;
  sube(s);
  return p;
}

/** El id de un miembro del equipo sale de su correo: es el mismo cada vez que entra, en cualquier pestaña. */
export function idMiembro(email: string): string {
  return 'eq_' + createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 8);
}

export function unirseEquipo(s: Sesion, email: string, nombre: string): Miembro {
  const id = idMiembro(email);
  const existente = s.equipo[id];
  if (existente) {
    if (nombre && existente.nombre !== nombre) { existente.nombre = nombre; sube(s); }
    return existente;
  }
  const m: Miembro = { id, nombre: nombre.trim().slice(0, 60) || 'Equipo', email: email.trim().toLowerCase(), enEscenario: false, conectado: false };
  s.equipo[id] = m;
  sube(s);
  return m;
}

/** Llamar a la sala verde: desde el lobby, o regresarlo desde backstage o escenario. */
export function llamar(s: Sesion, pid: string, equipoId: string): { cambio: boolean; de: Lugar } {
  viva(s); miembro(s, equipoId);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'verde' && p.verdeCon === equipoId) return { cambio: false, de };
  if (de === 'verde') throw new ErrorDominio('NO_PERMITIDO', 'Otra persona del equipo ya lo tiene en la sala verde');
  p.lugar = 'verde'; p.verdeCon = equipoId;
  sube(s);
  return { cambio: true, de };
}

/** De la sala verde a la sesión (queda en backstage, escuchando el escenario). */
export function pasarASesion(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'backstage' || de === 'escenario') return { cambio: false, de };
  if (de !== 'verde') throw new ErrorDominio('NO_PERMITIDO', 'Primero hay que llamarlo a la sala verde');
  p.lugar = 'backstage'; p.verdeCon = null;
  sube(s);
  return { cambio: true, de };
}

export function regresarALobby(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'lobby') return { cambio: false, de };
  p.lugar = 'lobby'; p.verdeCon = null;
  sube(s);
  return { cambio: true, de };
}

/** Quitar o permitir el micrófono de un participante. Permitirlo NO lo enciende: la persona decide cuándo hablar. */
export function silenciar(s: Sesion, pid: string, silenciado: boolean): { cambio: boolean } {
  viva(s);
  const p = participante(s, pid);
  if (!!p.silenciado === silenciado) return { cambio: false };
  p.silenciado = silenciado;
  sube(s);
  return { cambio: true };
}

/** El equipo elige cómo se acomoda el escenario. Se guarda en el servidor: todos lo ven igual. */
export function ponerDiseno(s: Sesion, nuevo: Diseno): { cambio: boolean } {
  viva(s);
  const valido = (TIPOS_DISENO as readonly string[]).includes(nuevo.tipo) && (FORMAS_DISENO as readonly string[]).includes(nuevo.forma)
    && (AJUSTES_DISENO as readonly string[]).includes(nuevo.ajuste) && (FONDOS_DISENO as readonly string[]).includes(nuevo.fondo);
  if (!valido) throw new ErrorDominio('NO_PERMITIDO', 'Ese diseño no existe');
  if (nuevo.fijado !== null && !s.participantes[nuevo.fijado] && !s.equipo[nuevo.fijado]) throw new ErrorDominio('NO_ENCONTRADO', 'Esa persona no está en la sesión');
  const actual = normalizarDiseno(s.diseno);
  if (JSON.stringify(actual) === JSON.stringify(nuevo)) return { cambio: false };
  s.diseno = { ...nuevo };
  sube(s);
  return { cambio: true };
}

const MAX_MENSAJES = 300;

function guardarMensaje(s: Sesion, m: Omit<Mensaje, 'id' | 'en'>, ahora: number): Mensaje {
  const texto = m.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_CHAT);
  if (!texto) throw new ErrorDominio('NO_PERMITIDO', 'Escribe un mensaje');
  const nuevo: Mensaje = { ...m, texto, id: 'm_' + aleatorio(4), en: ahora };
  s.mensajes = [...(s.mensajes ?? []), nuevo].slice(-MAX_MENSAJES);
  sube(s);
  return nuevo;
}

/** El equipo escribe: en su chat interno, a la sala verde (a la persona que está ahí) o a la sesión (a todos o a una persona). */
export function mensajeDelEquipo(s: Sesion, equipoId: string, canal: CanalChat, texto: string, para: string, ahora = Date.now()): Mensaje {
  viva(s);
  const m = miembro(s, equipoId);
  let destino = 'equipo';
  if (canal === 'sesion') {
    if (para !== 'todos') participante(s, para);
    destino = para;
  } else if (canal === 'verde') {
    if (participante(s, para).lugar !== 'verde') throw new ErrorDominio('NO_PERMITIDO', 'Esa persona ya no está en la sala verde');
    destino = para;
  }
  return guardarMensaje(s, { canal, deId: m.id, deNombre: m.nombre, deRol: 'equipo', para: destino, texto }, ahora);
}

/**
 * Un participante le escribe al equipo. En la sala verde, a la sala verde; desde backstage en adelante, al chat de la sesión
 * (si el equipo lo cerró no puede). En el lobby todavía no.
 */
export function mensajeDeParticipante(s: Sesion, pid: string, texto: string, ahora = Date.now()): Mensaje {
  viva(s);
  const p = participante(s, pid);
  const base = { deId: p.id, deNombre: p.nombre, deRol: 'participante' as const, para: 'equipo', texto };
  if (p.lugar === 'verde') return guardarMensaje(s, { ...base, canal: 'verde' }, ahora);
  if (p.lugar !== 'backstage' && p.lugar !== 'escenario') throw new ErrorDominio('NO_PERMITIDO', 'Todavía no puedes escribir');
  const cfg = normalizarChat(s.chat);
  if (!cfg.abierto) throw new ErrorDominio('NO_PERMITIDO', 'El chat está cerrado');
  return guardarMensaje(s, { ...base, canal: 'sesion', grupal: cfg.grupal }, ahora);
}

/** El equipo abre o cierra el chat de la sesión y elige si los participantes se leen entre sí. */
export function ponerChat(s: Sesion, nuevo: ConfigChat): { cambio: boolean } {
  viva(s);
  const actual = normalizarChat(s.chat);
  if (actual.abierto === nuevo.abierto && actual.grupal === nuevo.grupal) return { cambio: false };
  s.chat = { abierto: !!nuevo.abierto, grupal: !!nuevo.grupal };
  sube(s);
  return { cambio: true };
}

/** Se empezó a transmitir: queda guardado desde cuándo (los highlights cuentan desde aquí). Pide tener la llave de Mux de la sala. */
export function iniciarEnVivo(s: Sesion, egressId: string, ahora = Date.now()): void {
  viva(s);
  if (s.envivo) throw new ErrorDominio('NO_PERMITIDO', 'La sesión ya está en vivo');
  if (!s.muxLlave) throw new ErrorDominio('NO_PERMITIDO', 'Esta sesión no tiene llave de transmisión: el Hub la manda al crear la sesión');
  s.envivo = { egressId, desde: ahora };
  sube(s);
}

/** Se terminó la transmisión. Devuelve el identificador del egress para pedirle a LiveKit que pare (o null si no había). */
export function detenerEnVivo(s: Sesion): string | null {
  if (!s.envivo) return null;
  const id = s.envivo.egressId;
  delete s.envivo;
  sube(s);
  return id;
}

const MAX_HIGHLIGHTS = 500;

/** Un clic marca el momento. Si se está al aire, queda ligado a ESE EN VIVO (la grabación cuenta desde que empezó); si no, solo guarda la hora. */
export function marcarHighlight(s: Sesion, equipoId: string, ahora = Date.now()): Highlight {
  viva(s);
  const m = miembro(s, equipoId);
  const h: Highlight = { id: 'h_' + aleatorio(3), en: ahora, vivoDesde: s.envivo?.desde ?? null, titulo: '', porNombre: m.nombre };
  s.highlights = [...(s.highlights ?? []), h].slice(-MAX_HIGHLIGHTS);
  sube(s);
  return h;
}

function highlight(s: Sesion, id: string): Highlight {
  const h = (s.highlights ?? []).find((x) => x.id === id);
  if (!h) throw new ErrorDominio('NO_ENCONTRADO', 'Ese highlight ya no existe');
  return h;
}

/** Ponerle título a mano (después la IA los nombrará al transcribir). Se puede aunque la sesión ya haya terminado. */
export function titularHighlight(s: Sesion, id: string, titulo: string): { cambio: boolean } {
  const h = highlight(s, id);
  const limpio = titulo.replace(/\s+/g, ' ').trim().slice(0, MAX_TITULO_HIGHLIGHT);
  if (h.titulo === limpio) return { cambio: false };
  h.titulo = limpio;
  sube(s);
  return { cambio: true };
}

export function borrarHighlight(s: Sesion, id: string): void {
  highlight(s, id);
  s.highlights = (s.highlights ?? []).filter((x) => x.id !== id);
  sube(s);
}

export function subir(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'escenario') return { cambio: false, de };
  if (de !== 'backstage') throw new ErrorDominio('NO_PERMITIDO', 'Solo se sube a quien está en backstage');
  p.lugar = 'escenario';
  sube(s);
  return { cambio: true, de };
}

export function bajar(s: Sesion, pid: string): { cambio: boolean; de: Lugar } {
  viva(s);
  const p = participante(s, pid);
  const de = p.lugar;
  if (de === 'backstage') return { cambio: false, de };
  if (de !== 'escenario') throw new ErrorDominio('NO_PERMITIDO', 'Solo se baja a quien está en el escenario');
  p.lugar = 'backstage';
  sube(s);
  return { cambio: true, de };
}

export function ponerMiembroEnEscenario(s: Sesion, equipoId: string, enEscenario: boolean): boolean {
  const m = miembro(s, equipoId);
  if (m.enEscenario === enEscenario) return false;
  m.enEscenario = enEscenario;
  sube(s);
  return true;
}

/** Conexión o desconexión del canal en vivo. Es presencia: no mueve a nadie de lugar. */
export function marcarConexion(s: Sesion, quien: { participanteId?: string; equipoId?: string }, conectado: boolean): boolean {
  const o = quien.participanteId ? s.participantes[quien.participanteId] : quien.equipoId ? s.equipo[quien.equipoId] : undefined;
  if (!o || o.conectado === conectado) return false;
  o.conectado = conectado;
  sube(s);
  return true;
}

export function terminar(s: Sesion): boolean {
  if (s.terminada) return false;
  s.terminada = true;
  sube(s);
  return true;
}
