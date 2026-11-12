import { useEffect, useRef } from 'react';
import type { RemoteTrack, LocalTrack, RemoteAudioTrack } from 'livekit-client';
import { traza } from '../lib/traza';

/** Video de una pista de LiveKit, o de un MediaStream local (la vista previa). */
export function Video({ pista, flujo, espejo, className }: {
  pista?: RemoteTrack | LocalTrack | null; flujo?: MediaStream | null; espejo?: boolean; className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pista) {
      const alReproducir = () => traza('video-reproduce', { de: (pista as { sid?: string }).sid });
      el.addEventListener('playing', alReproducir); el.addEventListener('loadeddata', alReproducir);
      pista.attach(el);
      return () => { el.removeEventListener('playing', alReproducir); el.removeEventListener('loadeddata', alReproducir); pista.detach(el); };
    }
    if (flujo) { el.srcObject = flujo; void el.play().catch(() => undefined); return () => { el.srcObject = null; }; }
  }, [pista, flujo]);
  return <video ref={ref} autoPlay playsInline muted className={`${espejo ? 'espejo ' : ''}${className ?? ''}`} />;
}

/** Sonido de las personas que se reciben. Un solo elemento de audio por pista. */
export function AudioRemoto({ pista }: { pista: RemoteAudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    pista.attach(el);
    return () => { pista.detach(el); };
  }, [pista]);
  return <audio ref={ref} autoPlay />;
}
