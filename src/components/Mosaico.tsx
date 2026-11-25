import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { LocalTrack, RemoteTrack } from 'livekit-client';
import type { AjusteDiseno } from '../../compartido/tipos';
import { ajusteDeImagen, hayDiagnostico, medidasPropias, posicionDeImagen, type LimitesPropios, type Medida } from '../lib/imagen';
import { Video } from './Video';

/** Silueta plana de los dibujos aprobados: se ve mientras llega el primer cuadro de video (nunca una pantalla negra). */
function Silueta() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <circle cx="50" cy="40" r="15" fill="var(--color-silueta)" />
      <path d="M20 100c0-20 13-32 30-32s30 12 30 32z" fill="var(--color-silueta)" />
    </svg>
  );
}

/** El lienzo del escenario dice cómo se ajusta la imagen en sus viñetas: llenarla (recorta) o mostrarla completa. */
export const AjusteContext = createContext<AjusteDiseno>('llenar');

export function Mosaico({ nombre, pista, flujo, espejo, esYo, etiqueta, propia, pantalla, children, className }: {
  nombre: string;
  pista?: RemoteTrack | LocalTrack | null;
  flujo?: MediaStream | null;
  espejo?: boolean;
  /** «Tú»: único uso del dorado en la pantalla del participante. */
  esYo?: boolean;
  etiqueta?: string;
  /** Recuadro que toma la forma del video de la persona (vertical si manda su celular en vertical), sin pasar de estos límites. Solo para vistas propias. */
  propia?: LimitesPropios;
  /** Es una pantalla compartida: se muestra SIEMPRE entera (nunca se recorta, aunque el diseño diga «llenar»), sobre negro y sin silueta. */
  pantalla?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const ajusteElegido = useContext(AjusteContext);
  const hayVideo = !!pista || !!flujo;
  const raiz = useRef<HTMLDivElement>(null);
  const [video, setVideo] = useState<Medida | null>(null); // tamaño real del video que llega
  const [celda, setCelda] = useState<Medida | null>(null); // tamaño de este recuadro
  const medirVideo = (m: Medida) => setVideo((a) => (a && a.w === m.w && a.h === m.h ? a : m));
  useEffect(() => { if (!hayVideo) setVideo(null); }, [hayVideo]);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const medir = () => setCelda((a) => { const w = Math.round(el.clientWidth); const h = Math.round(el.clientHeight); return a && a.w === w && a.h === h ? a : { w, h }; });
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  // Un video vertical en un recuadro horizontal se muestra entero en vez de recortarle la cara; el equipo puede pedir «completo» para todos.
  const ajuste = ajusteDeImagen(pantalla ? 'completo' : ajusteElegido, video, celda);
  const completo = !pantalla && ajusteElegido === 'completo';
  // Si quien lo usa lo posiciona (absolute, fixed...), no se le impone «relative».
  const posicion = /\b(absolute|fixed|sticky)\b/.test(className ?? '') ? '' : 'relative';
  return (
    <div ref={raiz} className={`${posicion} overflow-hidden ${pantalla ? 'bg-black' : completo ? 'bg-transparent' : 'bg-video'} ${className ?? ''}`} data-testid={`mosaico-${nombre}`}
      style={propia && video ? medidasPropias(video, propia) : undefined}
      data-ajuste-imagen={hayVideo ? ajuste : undefined} data-video={video ? `${video.w}x${video.h}` : undefined}
      title={video ? `Cámara: ${video.w}×${video.h}` : undefined}>
      {!video && !pantalla && <Silueta />}{/* solo mientras llega el primer cuadro: con la imagen entera (barras a los lados) no debe asomar por detrás */}
      {hayVideo && <Video pista={pista} flujo={flujo} espejo={espejo} alMedir={medirVideo} style={{ objectPosition: posicionDeImagen(ajuste, video) }} className={`fundido absolute inset-0 h-full w-full ${ajuste === 'contain' ? 'object-contain' : 'object-cover'}`} />}
      {video && hayDiagnostico() && <span data-testid="diagnostico-camara" className="absolute right-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">{video.w}×{video.h} {ajuste === 'contain' ? 'entera' : 'llena'}</span>}
      <span className={`absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-[11px] font-semibold ${esYo ? 'bg-oro text-oro-texto' : 'bg-white text-texto'}`}>
        {esYo ? 'Tú' : nombre}{etiqueta ? ` – ${etiqueta}` : ''}
      </span>
      {children}
    </div>
  );
}
