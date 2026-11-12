// Todo lo que el servidor le pide a LiveKit: pases de entrada, mover gente de sala y cambiar permisos.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from './config';

const salas = new RoomServiceClient(config.LIVEKIT_HTTP_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export const urlLivekit = config.LIVEKIT_WS_URL;

export async function asegurarSala(nombre: string): Promise<void> {
  // Si ya existe, LiveKit devuelve la misma. Se cierra sola si queda vacía.
  await salas.createRoom({ name: nombre, emptyTimeout: 300, departureTimeout: 30 });
}

/**
 * Pase de un participante para la sala de la sesión. En el lobby entra sin publicar ni recibir nada; en la sala verde,
 * backstage y escenario puede publicar cámara y micrófono y recibir. Sin nombre: en LiveKit solo hay un código al azar,
 * el nombre que escribió vive en el servidor.
 */
export async function tokenParticipante(sala: string, participanteId: string, p: { publicar: boolean; recibir: boolean }): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: participanteId, ttl: 6 * 3600 });
  at.addGrant({
    roomJoin: true, room: sala, canPublish: p.publicar, canSubscribe: p.recibir, canPublishData: false, canUpdateOwnMetadata: false,
    ...(p.publicar ? { canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] } : {}),
  });
  return at.toJwt();
}

export async function tokenEquipo(sala: string, equipoId: string, nombre: string): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: equipoId, name: nombre, ttl: 6 * 3600 });
  at.addGrant({ roomJoin: true, room: sala, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
  return at.toJwt();
}

export class PersonaDesconectada extends Error {}

/** Qué puede hacer una persona dentro de la sala. En el lobby no publica ni recibe. */
export async function permisos(sala: string, participanteId: string, p: { publicar: boolean; recibir: boolean }): Promise<void> {
  try {
    await salas.updateParticipant(sala, participanteId, {
      permission: {
        canPublish: p.publicar,
        canSubscribe: p.recibir,
        canPublishData: false,
        canPublishSources: p.publicar ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
        canUpdateMetadata: false,
      },
    });
  } catch (e) {
    const texto = String((e as Error).message ?? e).toLowerCase();
    if (texto.includes('not found') || texto.includes('not_found') || texto.includes('does not exist')) throw new PersonaDesconectada('La persona no está conectada');
    throw e;
  }
}

export async function borrarSala(nombre: string): Promise<void> {
  try { await salas.deleteRoom(nombre); } catch { /* ya no existía */ }
}

export async function participantesEnSala(nombre: string): Promise<string[]> {
  try { return (await salas.listParticipants(nombre)).map((p) => p.identity); } catch { return []; }
}
