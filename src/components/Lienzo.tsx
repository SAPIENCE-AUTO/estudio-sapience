import type { Diseno, FormaDiseno } from '../../compartido/tipos';
import { acomodo, columnasPara, ordenar } from '../lib/acomodo';
import { AjusteContext } from './Mosaico';

export interface Viñeta { id: string; nodo: React.ReactNode }

const FONDOS = { gris: 'bg-video', blanco: 'bg-white', negro: 'bg-[#14181a]', marca: 'bg-teal' } as const;
const RADIOS: Record<Exclude<FormaDiseno, 'circulo'>, string> = { cuadrada: 'rounded-sm', redondeada: 'rounded-xl' };

/**
 * Una celda del lienzo. En círculo, la viñeta es el círculo más grande que cabe en la celda (la medida sale de la propia celda).
 */
function Celda({ v, forma, className = '', estilo }: { v: Viñeta; forma: FormaDiseno; className?: string; estilo?: React.CSSProperties }) {
  if (forma === 'circulo') {
    return (
      <div className={`relative flex min-h-0 min-w-0 items-center justify-center [container-type:size] ${className}`} style={estilo}>
        <div className="relative overflow-hidden rounded-full" style={{ width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' }}>{v.nodo}</div>
      </div>
    );
  }
  return <div className={`relative min-h-0 min-w-0 overflow-hidden ${RADIOS[forma]} ${className}`} style={estilo}>{v.nodo}</div>;
}

/**
 * El escenario: un lienzo de proporción fija 16:9 (lo que se grabe o se transmita tendrá siempre esta forma).
 * Lo de adentro sigue el diseño que eligió el equipo: acomodo, forma de la viñeta, ajuste de la imagen y fondo.
 */
export function Lienzo({ items, diseno, vacio, className, ...resto }: {
  items: Viñeta[];
  diseno: Diseno;
  /** Texto cuando no hay nadie. */
  vacio?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const personas = ordenar(items, diseno);
  const n = personas.length;
  const { forma } = diseno;
  // La persona grande de los acomodos con foco nunca es un círculo (se vería recortada): conserva la esquina redondeada.
  const formaGrande: FormaDiseno = forma === 'circulo' ? 'redondeada' : forma;

  let contenido: React.ReactNode;
  if (n === 0) {
    contenido = vacio ? <div className="flex flex-1 items-center justify-center text-[13px] text-tenue">{vacio}</div> : null;
  } else if (n === 1 || diseno.tipo === 'auto') {
    // Cuadrícula automática: una sola persona ocupa todo; de ahí en adelante filas parejas con la última centrada.
    const filas = acomodo(n);
    const ancho = `calc((100% - ${(columnasPara(n) - 1) * 6}px) / ${columnasPara(n)})`;
    let siguiente = 0;
    contenido = filas.map((cuantas, fila) => (
      <div key={fila} className="flex min-h-0 flex-1 justify-center gap-1.5">
        {personas.slice(siguiente, (siguiente += cuantas)).map((v) => <Celda key={v.id} v={v} forma={forma} className="h-full" estilo={{ width: ancho }} />)}
      </div>
    ));
  } else if (diseno.tipo === 'lado') {
    contenido = <div className="flex min-h-0 flex-1 gap-1.5">{personas.map((v) => <Celda key={v.id} v={v} forma={forma} className="flex-1" />)}</div>;
  } else if (diseno.tipo === 'fila') {
    // Una sola fila centrada, viñetas verticales: pensada para paneles de varias personas.
    contenido = (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2">
        {personas.map((v) => <Celda key={v.id} v={v} forma={forma} className="h-[92%] shrink" estilo={{ aspectRatio: '3 / 4' }} />)}
      </div>
    );
  } else if (diseno.tipo === 'foco') {
    contenido = (
      <div className="flex min-h-0 flex-1 gap-1.5">
        <Celda v={personas[0]!} forma={formaGrande} className="flex-[3]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">{personas.slice(1).map((v) => <Celda key={v.id} v={v} forma={forma} className="flex-1" />)}</div>
      </div>
    );
  } else if (diseno.tipo === 'tira-abajo') {
    contenido = (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <Celda v={personas[0]!} forma={formaGrande} className="flex-[3]" />
        <div className="flex min-h-0 flex-1 gap-1.5">{personas.slice(1).map((v) => <Celda key={v.id} v={v} forma={forma} className="flex-1" />)}</div>
      </div>
    );
  } else {
    // Foco con viñetas flotantes: la persona fijada ocupa todo y las demás van en círculos abajo a la derecha.
    contenido = (
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 overflow-hidden ${RADIOS[formaGrande as 'cuadrada' | 'redondeada']}`}>{personas[0]!.nodo}</div>
        <div className="absolute bottom-3 right-3 flex gap-2">
          {personas.slice(1).map((v) => <div key={v.id} className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-white md:h-20 md:w-20">{v.nodo}</div>)}
        </div>
      </div>
    );
  }

  return (
    <AjusteContext.Provider value={diseno.ajuste}>
      <div {...resto} data-diseno={diseno.tipo} data-forma={diseno.forma} data-ajuste={diseno.ajuste} data-fondo={diseno.fondo}
        className={`flex aspect-video w-full flex-col gap-1.5 overflow-hidden rounded-2xl p-1.5 ${FONDOS[diseno.fondo]} ${diseno.fondo === 'blanco' ? 'border border-borde' : ''} ${className ?? ''}`}>{contenido}</div>
    </AjusteContext.Provider>
  );
}
