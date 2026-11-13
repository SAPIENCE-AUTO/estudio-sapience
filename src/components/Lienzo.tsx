import { acomodo, columnasPara } from '../lib/acomodo';

/**
 * El escenario: un lienzo de proporción fija 16:9 (lo que se grabe o se transmita tendrá siempre esta forma).
 * Lo de adentro se acomoda solo según cuánta gente hay (ver lib/acomodo.ts).
 */
export function Lienzo({ items, vacio, className, ...resto }: {
  items: React.ReactNode[];
  /** Texto cuando no hay nadie. */
  vacio?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const filas = acomodo(items.length);
  const columnas = columnasPara(items.length);
  const ancho = `calc((100% - ${(columnas - 1) * 6}px) / ${columnas})`;
  let siguiente = 0;
  return (
    <div {...resto} className={`flex aspect-video w-full flex-col gap-1.5 overflow-hidden rounded-2xl bg-video p-1.5 ${className ?? ''}`}>
      {filas.length === 0 && vacio && <div className="flex flex-1 items-center justify-center text-[13px] text-tenue">{vacio}</div>}
      {filas.map((cuantas, fila) => (
        <div key={fila} className="flex min-h-0 flex-1 justify-center gap-1.5">
          {items.slice(siguiente, (siguiente += cuantas)).map((item, i) => (
            <div key={i} className="relative h-full min-w-0 overflow-hidden rounded-xl" style={{ width: ancho }}>{item}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
