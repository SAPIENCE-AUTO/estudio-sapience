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
}

export type Estado = EstadoEquipo | EstadoParticipante;

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
