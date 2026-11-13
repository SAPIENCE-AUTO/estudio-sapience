// Tipos que comparten el servidor y la interfaz. Lo que viaja por la red está aquí, en un solo lugar.

/** Cómo se acomoda la gente en el escenario. Lo decide el equipo y lo ven todos igual (también lo que se grabe o se transmita). */
export const TIPOS_DISENO = ['auto', 'foco', 'tira-abajo', 'lado', 'fila', 'redondas'] as const;
export const FORMAS_DISENO = ['cuadrada', 'redondeada', 'circulo'] as const;
export const AJUSTES_DISENO = ['llenar', 'completo'] as const;
export const FONDOS_DISENO = ['gris', 'blanco', 'negro', 'marca'] as const;
/** Acomodo: dónde va cada quien. */
export type TipoDiseno = (typeof TIPOS_DISENO)[number];
/** Forma de la viñeta (el círculo incluye al moderador). */
export type FormaDiseno = (typeof FORMAS_DISENO)[number];
/** «Llenar» recorta los bordes del video; «completo» lo muestra entero y deja espacio. */
export type AjusteDiseno = (typeof AJUSTES_DISENO)[number];
export type FondoDiseno = (typeof FONDOS_DISENO)[number];
export interface Diseno {
  tipo: TipoDiseno;
  /** Quién va grande en «foco», «tira-abajo» y «redondas» (si no está en el escenario, va el primero). */
  fijado: string | null;
  forma: FormaDiseno;
  ajuste: AjusteDiseno;
  fondo: FondoDiseno;
}
export const DISENO_INICIAL: Diseno = { tipo: 'auto', fijado: null, forma: 'redondeada', ajuste: 'llenar', fondo: 'gris' };
/** Completa lo que falte (sesiones guardadas antes de que existieran la forma, el ajuste y el fondo). */
export const normalizarDiseno = (d?: Partial<Diseno> | null): Diseno => ({ ...DISENO_INICIAL, ...(d ?? {}) });

/**
 * Los chats son de un lugar y los ve quien está ahí:
 * - equipo: solo el equipo (interno; nunca lo ve un participante).
 * - verde: la persona que está en la sala verde y el equipo.
 * - sesion: los que están adentro (backstage y escenario) y el equipo. «Solo con el equipo» o «grupal», y se puede cerrar.
 */
export type CanalChat = 'equipo' | 'verde' | 'sesion';
/** Cómo está el chat de la sesión: abierto o cerrado, y si los participantes se leen entre sí. */
export interface ConfigChat { abierto: boolean; grupal: boolean }
export const CHAT_INICIAL: ConfigChat = { abierto: true, grupal: false };
export const normalizarChat = (c?: Partial<ConfigChat> | null): ConfigChat => ({ ...CHAT_INICIAL, ...(c ?? {}) });
export interface MensajePublico {
  id: string;
  canal: CanalChat;
  deId: string;
  deNombre: string;
  deRol: 'equipo' | 'participante';
  /** Equipo: 'equipo' (lo escribió un participante), 'todos' o el id de la persona a quien contesta. Participante: 'todos', 'tu' o 'equipo'. */
  para: string;
  texto: string;
  en: number;
}
export const MAX_TEXTO_CHAT = 500;

/** Un momento marcado por el equipo. Solo lo ve el equipo: los participantes nunca lo reciben. */
export interface HighlightPublico {
  id: string;
  /** Cuándo se marcó (hora del servidor, en milisegundos). */
  en: number;
  /** Cuándo empezó el EN VIVO al que pertenece (la grabación cuenta desde ahí); null si se marcó sin estar al aire. */
  vivoDesde: number | null;
  titulo: string;
  porNombre: string;
}
export const MAX_TITULO_HIGHLIGHT = 120;

/** La sesión se está transmitiendo (y Mux la graba). Lo ve el equipo y también los participantes: tienen derecho a saberlo. */
export interface EnVivo { desde: number }

/** Dónde está una persona. El orden de las salas es: lobby → sala verde → sesión (backstage o escenario). */
export type Lugar = 'lobby' | 'verde' | 'backstage' | 'escenario';

export interface ParticipantePublico {
  id: string;
  nombre: string;
  lugar: Lugar;
  /** Id del miembro del equipo que lo llamó a la sala verde (solo cuando lugar = 'verde'). */
  verdeCon: string | null;
  conectado: boolean;
  entroEn: number;
  /** El equipo le quitó el micrófono: no puede hablar hasta que se lo permitan. */
  silenciado: boolean;
}

export interface MiembroPublico {
  id: string;
  nombre: string;
  enEscenario: boolean;
  conectado: boolean;
}

/** Lo que ve el equipo: todo. */
export interface EstadoEquipo {
  tipo: 'estado';
  rol: 'equipo';
  /** Número de versión: solo sube. Lo que llegue con una versión igual o menor a la ya vista se ignora. */
  v: number;
  yo: string;
  sesion: { id: string; nombre: string; codigo: string; terminada: boolean };
  participantes: ParticipantePublico[];
  equipo: MiembroPublico[];
  diseno: Diseno;
  chat: ConfigChat;
  mensajes: MensajePublico[];
  envivo: EnVivo | null;
  highlights: HighlightPublico[];
  /** «lista»: hay una llave de Mux para transmitir. «sin-llave»: falta (el Hub la manda al crear la sesión). La llave NUNCA viaja. */
  transmision: 'lista' | 'sin-llave';
}

/** Lo que ve un participante: solo lo suyo, el equipo y quién está en el escenario. Nunca la lista completa. */
export interface EstadoParticipante {
  tipo: 'estado';
  rol: 'participante';
  v: number;
  sesion: { nombre: string; terminada: boolean };
  yo: { id: string; nombre: string; lugar: Lugar; verdeCon: string | null; silenciado: boolean };
  equipo: { id: string; nombre: string; enEscenario: boolean }[];
  escenario: { id: string; nombre: string }[];
  diseno: Diseno;
  chat: ConfigChat;
  envivo: EnVivo | null;
  /** Solo lo que este participante puede leer: lo suyo y lo que el equipo le escribió a él o a todos. NUNCA el chat del equipo. */
  mensajes: MensajePublico[];
}

/**
 * Lo que ve la página que se TRANSMITE (la que LiveKit abre y manda a Mux): solo el diseño y quién está en el escenario, con su nombre.
 * Nada de backstage, ni sala verde, ni lobby, ni chats.
 */
export interface EstadoGrabadora {
  tipo: 'estado';
  rol: 'grabadora';
  v: number;
  diseno: Diseno;
  escena: { id: string; nombre: string }[];
}

export type Estado = EstadoEquipo | EstadoParticipante | EstadoGrabadora;

/**
 * UNA sola sala de LiveKit por sesión. Lobby, sala verde, backstage y escenario son estados dentro de esa sala:
 * quién puede publicar y quién puede recibir lo que publica cada quien. Nadie se mueve de sala (mover gente de sala
 * dejaba a algunas personas con la recepción lenta: de 1 a 4 segundos para ver a quien subía al escenario).
 */
export const salaSesion = (sesionId: string) => `sesion.${sesionId}`;

// ---- Respuestas de la API ----
export interface RespuestaEntrar {
  sesionId: string;
  participanteId: string;
  /** Pase firmado: sirve para abrir el canal en vivo y para las acciones del participante. */
  pase: string;
  livekit: { url: string; token: string; sala: string };
}

export interface RespuestaAccion {
  /** Versión del estado después de la acción. La interfaz optimista descarta su parche al ver esta versión. */
  v: number;
}

export interface RespuestaTokenEquipo {
  url: string;
  token: string;
  sala: string;
}
