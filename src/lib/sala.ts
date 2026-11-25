// Ayudas para trabajar con una sala de LiveKit desde React.
import { useEffect, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteAudioTrack } from 'livekit-client';
import type { Lugar } from '../../compartido/tipos';
import { mismosPermitidos, permisosDePistas, type Permitidos } from './permisos';
import { traza } from './traza';

export type { Permitidos };

const EVENTOS = [
  RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.Moved, RoomEvent.ParticipantPermissionsChanged,
  RoomEvent.ConnectionStateChanged, RoomEvent.AudioPlaybackStatusChanged,
] as const;

/** Vuelve a dibujar la pantalla cuando algo cambia en la sala. La pantalla se dibuja del estado del servidor; esto solo refresca los videos. */
export function useCambiosDeSala(room: Room | null): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!room) return;
    const f = () => setN((n) => n + 1);
    const alSuscribir = (t: { kind: string }, _p: unknown, quien: { identity: string }) => traza('suscrito', { de: quien.identity, tipo: t.kind });
    const alQuitar = (t: { kind: string }, _p: unknown, quien: { identity: string }) => traza('sin-suscripcion', { de: quien.identity, tipo: t.kind });
    const alFallar = (sid: string, quien: { identity: string } | undefined, motivo?: unknown) => traza('suscripcion-fallida', { de: quien?.identity, motivo: String(motivo) });
    room.on(RoomEvent.TrackSubscribed, alSuscribir as never); room.on(RoomEvent.TrackUnsubscribed, alQuitar as never); room.on(RoomEvent.TrackSubscriptionFailed, alFallar as never);
    for (const e of EVENTOS) room.on(e as RoomEvent.TrackSubscribed, f);
    return () => {
      room.off(RoomEvent.TrackSubscribed, alSuscribir as never); room.off(RoomEvent.TrackUnsubscribed, alQuitar as never); room.off(RoomEvent.TrackSubscriptionFailed, alFallar as never);
      for (const e of EVENTOS) room.off(e as RoomEvent.TrackSubscribed, f);
    };
  }, [room]);
}

export function camaraDe(room: Room | null, identidad: string) {
  return room?.remoteParticipants.get(identidad)?.getTrackPublication(Track.Source.Camera)?.track ?? null;
}

/** La pantalla compartida de alguien (video), si la comparte y no está silenciada. Sirve para la propia (local) y para la de otros. */
export function pantallaDe(room: Room | null, identidad: string) {
  if (!room) return null;
  const quien = room.localParticipant.identity === identidad ? room.localParticipant : room.remoteParticipants.get(identidad);
  const pub = quien?.getTrackPublication(Track.Source.ScreenShare);
  return pub && !pub.isMuted ? pub.track ?? null : null;
}

/** El sonido de la pantalla compartida de otra persona (solo existe si el navegador de quien comparte lo pudo capturar). */
export function sonidoPantallaDe(room: Room | null, identidad: string): RemoteAudioTrack | null {
  return (room?.remoteParticipants.get(identidad)?.getTrackPublication(Track.Source.ScreenShareAudio)?.track as RemoteAudioTrack | undefined) ?? null;
}

/** Todo el sonido que se recibe de los demás: micrófonos y sonido de pantalla compartida. */
export function pistasDeSonido(room: Room | null): RemoteAudioTrack[] {
  if (!room) return [];
  const pistas: RemoteAudioTrack[] = [];
  for (const p of room.remoteParticipants.values()) {
    for (const fuente of [Track.Source.Microphone, Track.Source.ScreenShareAudio]) {
      const t = p.getTrackPublication(fuente)?.track;
      if (t) pistas.push(t as RemoteAudioTrack);
    }
  }
  return pistas;
}

const quitarProteccion = new WeakMap<Room, () => void>();
const esDePantalla = (fuente: Track.Source) => fuente === Track.Source.ScreenShare || fuente === Track.Source.ScreenShareAudio;

/**
 * Cada persona protege SUS pistas: solo quienes están en la lista pueden recibir su video y su audio.
 * Se llama ANTES de publicar y cada vez que cambia el lugar o el equipo.
 * `pantalla` es quién puede recibir su PANTALLA COMPARTIDA (por defecto, los mismos que lo demás). Si es otro grupo (por ejemplo, la pantalla
 * solo para el equipo mientras la cámara va a todos), las pistas se listan una por una y se vuelven a calcular cuando cambian las propias o llega alguien.
 */
export function proteger(room: Room, permitidos: Permitidos, pantalla: Permitidos = permitidos): void {
  traza('proteger-pistas', { a: permitidos === 'todos' ? 'todos' : `${permitidos.length} personas`, pantalla: pantalla === 'todos' ? 'todos' : `${pantalla.length} personas` });
  quitarProteccion.get(room)?.();
  quitarProteccion.delete(room);
  const yo = room.localParticipant;
  const aplicar = () => {
    const pistas = [...yo.trackPublications.values()].filter((p) => p.trackSid).map((p) => ({ sid: p.trackSid, esPantalla: esDePantalla(p.source) }));
    const r = permisosDePistas({ permitidos, pantalla, conocidos: [...room.remoteParticipants.keys()], pistas });
    yo.setTrackSubscriptionPermissions(r.todos, r.porPersona);
  };
  aplicar();
  if (mismosPermitidos(permitidos, pantalla)) return;
  const eventos = [RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected] as const;
  for (const e of eventos) room.on(e as RoomEvent.LocalTrackPublished, aplicar);
  quitarProteccion.set(room, () => { for (const e of eventos) room.off(e as RoomEvent.LocalTrackPublished, aplicar); });
}

/** Escenario: lo recibe cualquiera. Sala verde: solo quien me llamó (es privado). Backstage: solo el equipo. */
export function permitidosDeParticipante(lugar: Lugar, equipoIds: string[], verdeCon: string | null): Permitidos {
  if (lugar === 'escenario') return 'todos';
  if (lugar === 'verde') return verdeCon ? [verdeCon] : [];
  return equipoIds;
}

/** El servidor da el permiso de publicar antes de avisar del cambio de lugar, pero puede tardar un instante en llegar a esta pantalla. */
export async function esperarPermisoDePublicar(room: Room, ms = 4000): Promise<boolean> {
  const t0 = Date.now();
  while (!room.localParticipant.permissions?.canPublish && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 40));
  return !!room.localParticipant.permissions?.canPublish;
}
