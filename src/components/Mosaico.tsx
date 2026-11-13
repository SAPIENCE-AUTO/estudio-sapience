import { createContext, useContext } from 'react';
import type { LocalTrack, RemoteTrack } from 'livekit-client';
import type { AjusteDiseno } from '../../compartido/tipos';
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

export function Mosaico({ nombre, pista, flujo, espejo, esYo, etiqueta, children, className }: {
  nombre: string;
  pista?: RemoteTrack | LocalTrack | null;
  flujo?: MediaStream | null;
  espejo?: boolean;
  /** «Tú»: único uso del dorado en la pantalla del participante. */
  esYo?: boolean;
  etiqueta?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const completo = useContext(AjusteContext) === 'completo';
  const hayVideo = !!pista || !!flujo;
  // Si quien lo usa lo posiciona (absolute, fixed...), no se le impone «relative».
  const posicion = /\b(absolute|fixed|sticky)\b/.test(className ?? '') ? '' : 'relative';
  return (
    <div className={`${posicion} overflow-hidden ${completo ? 'bg-transparent' : 'bg-video'} ${className ?? ''}`} data-testid={`mosaico-${nombre}`}>
      <Silueta />
      {hayVideo && <Video pista={pista} flujo={flujo} espejo={espejo} className={`fundido absolute inset-0 h-full w-full ${completo ? 'object-contain' : 'object-cover'}`} />}
      <span className={`absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-[11px] font-semibold ${esYo ? 'bg-oro text-oro-texto' : 'bg-white text-texto'}`}>
        {esYo ? 'Tú' : nombre}{etiqueta ? ` – ${etiqueta}` : ''}
      </span>
      {children}
    </div>
  );
}
