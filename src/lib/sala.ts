// Ayudas para trabajar con una sala de LiveKit desde React.
import { useEffect, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { Lugar } from '../../compartido/tipos';
import { traza } from './traza';

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

export type Permitidos = 'todos' | string[];

/**
 * Cada persona protege SUS pistas: solo quienes están en la lista pueden recibir su video y su audio.
 * Se llama ANTES de publicar y cada vez que cambia el lugar o el equipo.
 */
export function proteger(room: Room, permitidos: Permitidos): void {
  traza('proteger-pistas', { a: permitidos === 'todos' ? 'todos' : `${permitidos.length} personas` });
  if (permitidos === 'todos') room.localParticipant.setTrackSubscriptionPermissions(true);
  else room.localParticipant.setTrackSubscriptionPermissions(false, permitidos.map((id) => ({ participantIdentity: id, allowAll: true })));
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
