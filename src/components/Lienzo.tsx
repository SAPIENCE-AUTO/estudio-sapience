import type { Diseno } from '../../compartido/tipos';
import { acomodo, columnasPara, ordenar } from '../lib/acomodo';

export interface Viñeta { id: string; nodo: React.ReactNode }

/**
 * El escenario: un lienzo de proporción fija 16:9 (lo que se grabe o se transmita tendrá siempre esta forma).
 * Lo de adentro se acomoda según el diseño que eligió el equipo (cuadrícula automática, foco, lado a lado o viñetas redondas).
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
  const caja = (v: Viñeta, extra = '') => <div key={v.id} className={`relative min-h-0 min-w-0 overflow-hidden rounded-xl ${extra}`}>{v.nodo}</div>;

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
        {personas.slice(siguiente, (siguiente += cuantas)).map((v) => <div key={v.id} className="relative h-full min-w-0 overflow-hidden rounded-xl" style={{ width: ancho }}>{v.nodo}</div>)}
      </div>
    ));
  } else if (diseno.tipo === 'lado') {
    contenido = <div className="flex min-h-0 flex-1 gap-1.5">{personas.map((v) => caja(v, 'flex-1'))}</div>;
  } else if (diseno.tipo === 'foco') {
    contenido = (
      <div className="flex min-h-0 flex-1 gap-1.5">
        {caja(personas[0]!, 'flex-[3]')}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">{personas.slice(1).map((v) => caja(v, 'flex-1'))}</div>
      </div>
    );
  } else {
    // Viñetas redondas: la persona fijada ocupa todo y las demás van en círculos abajo a la derecha.
    contenido = (
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden rounded-xl">{personas[0]!.nodo}</div>
        <div className="absolute bottom-3 right-3 flex gap-2">
          {personas.slice(1).map((v) => <div key={v.id} className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-white md:h-20 md:w-20">{v.nodo}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div {...resto} data-diseno={diseno.tipo} className={`flex aspect-video w-full flex-col gap-1.5 overflow-hidden rounded-2xl bg-video p-1.5 ${className ?? ''}`}>{contenido}</div>
  );
}
