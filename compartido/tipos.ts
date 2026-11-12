// Tipos que comparten el servidor y la interfaz. Lo que viaja por la red está aquí, en un solo lugar.

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
}

/** Lo que ve un participante: solo lo suyo, el equipo y quién está en el escenario. Nunca la lista completa. */
export interface EstadoParticipante {
  tipo: 'estado';
  rol: 'participante';
  v: number;
  sesion: { nombre: string; terminada: boolean };
  yo: { id: string; nombre: string; lugar: Lugar; verdeCon: string | null };
  equipo: { id: string; nombre: string; enEscenario: boolean }[];
  escenario: { id: string; nombre: string }[];
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
