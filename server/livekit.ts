// Todo lo que el servidor le pide a LiveKit: pases de entrada, mover gente de sala y cambiar permisos.
import { AccessToken, EgressClient, EgressStatus, EncodingOptionsPreset, RoomServiceClient, StreamOutput, StreamProtocol, TrackSource } from 'livekit-server-sdk';
import { randomBytes } from 'node:crypto';
import { config } from './config';

const salas = new RoomServiceClient(config.LIVEKIT_HTTP_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

const egress = new EgressClient(config.LIVEKIT_HTTP_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

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
const fuentes = (microfono: boolean | undefined) => (microfono === false ? [TrackSource.CAMERA] : [TrackSource.CAMERA, TrackSource.MICROPHONE]);

export async function tokenParticipante(sala: string, participanteId: string, p: { publicar: boolean; recibir: boolean; microfono?: boolean }): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: participanteId, ttl: 6 * 3600 });
  at.addGrant({
    roomJoin: true, room: sala, canPublish: p.publicar, canSubscribe: p.recibir, canPublishData: false, canUpdateOwnMetadata: false,
    ...(p.publicar ? { canPublishSources: fuentes(p.microfono) } : {}),
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
export async function permisos(sala: string, participanteId: string, p: { publicar: boolean; recibir: boolean; microfono?: boolean }): Promise<void> {
  try {
    await salas.updateParticipant(sala, participanteId, {
      permission: {
        canPublish: p.publicar,
        canSubscribe: p.recibir,
        canPublishData: false,
        canPublishSources: p.publicar ? fuentes(p.microfono) : [],
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

/**
 * Pase de la página que se transmite: entra OCULTA (nadie la ve en la sala), solo escucha y mira (no publica), y con permiso de grabador
 * para recibir también las pistas que cada persona protege. La página decide qué muestra y qué escucha: solo a quienes están en el escenario.
 */
export async function tokenGrabadora(sala: string): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: 'gr_' + randomBytes(4).toString('hex'), ttl: 12 * 3600 });
  at.addGrant({ roomJoin: true, room: sala, canSubscribe: true, canPublish: false, canPublishData: false, hidden: true, recorder: true });
  return at.toJwt();
}

// ───────── EN VIVO: LiveKit abre una página de Talks y manda lo que dibuja a Mux ─────────

/** Quita la llave de Mux de cualquier texto (los mensajes de error de LiveKit pueden repetir la dirección de transmisión). */
export const sinLlave = (texto: string, llave: string): string => (llave ? texto.split(llave).join('…') : texto);

/** Empieza a transmitir la página `url` hacia `destino` (rtmps://…/<llave>). Devuelve el identificador del egress. NUNCA registrar `destino`. */
export async function empezarTransmision(url: string, destino: string): Promise<string> {
  const info = await egress.startWebEgress(
    url,
    new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [destino] }),
    // La página avisa con «START_RECORDING» cuando ya conectó y dibujó el escenario: así no sale una pantalla en blanco al aire.
    { awaitStartSignal: true, encodingOptions: EncodingOptionsPreset.H264_1080P_30 },
  );
  return info.egressId;
}

/** Espera a que la transmisión esté al aire. Lanza si LiveKit la reporta fallida o si tarda demasiado. */
export async function esperarTransmision(egressId: string, ms = 40_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const [info] = await egress.listEgress({ egressId });
    if (info?.status === EgressStatus.EGRESS_ACTIVE) return;
    if (info && [EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED, EgressStatus.EGRESS_COMPLETE].includes(info.status)) {
      throw new Error(info.error || 'LiveKit no pudo empezar la transmisión');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('La transmisión tardó demasiado en empezar');
}

/** Para la transmisión. Si ya había terminado, no pasa nada. */
export async function detenerTransmision(egressId: string): Promise<void> {
  try { await egress.stopEgress(egressId); } catch { /* ya estaba terminada */ }
}

/** ¿Sigue al aire? (al reiniciar el servidor se comprueba que la transmisión guardada todavía exista). */
export async function transmisionActiva(egressId: string): Promise<boolean> {
  const [info] = await egress.listEgress({ egressId });
  return info?.status === EgressStatus.EGRESS_ACTIVE || info?.status === EgressStatus.EGRESS_STARTING;
}
