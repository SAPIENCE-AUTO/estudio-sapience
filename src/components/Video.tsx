import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { RemoteTrack, LocalTrack, RemoteAudioTrack } from 'livekit-client';
import { traza } from '../lib/traza';
import type { Medida } from '../lib/imagen';

/** Video de una pista de LiveKit, o de un MediaStream local (la vista previa). `alMedir` avisa el tamaño real que llega (y cuando cambia, por ejemplo al girar el celular). */
export function Video({ pista, flujo, espejo, className, style, alMedir }: {
  pista?: RemoteTrack | LocalTrack | null; flujo?: MediaStream | null; espejo?: boolean; className?: string; style?: CSSProperties; alMedir?: (m: Medida) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const avisar = useRef(alMedir);
  avisar.current = alMedir;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => { if (el.videoWidth > 0 && el.videoHeight > 0) avisar.current?.({ w: el.videoWidth, h: el.videoHeight }); };
    el.addEventListener('loadedmetadata', medir);
    el.addEventListener('resize', medir);
    medir();
    return () => { el.removeEventListener('loadedmetadata', medir); el.removeEventListener('resize', medir); };
  }, []);
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
  return <video ref={ref} autoPlay playsInline muted style={style} className={`${espejo ? 'espejo ' : ''}${className ?? ''}`} />;
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
