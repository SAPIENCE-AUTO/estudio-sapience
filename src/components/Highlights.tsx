import { useEffect, useState } from 'react';
import { Download, Star, Trash2 } from 'lucide-react';
import { MAX_TITULO_HIGHLIGHT, type HighlightPublico } from '../../compartido/tipos';
import { api } from '../lib/api';
import { aCsv, minutoDe, nombreDeArchivo } from '../lib/highlights';
import { fechaYHora } from '../lib/tiempo';

function Fila({ sid, h, onError }: { sid: string; h: HighlightPublico; onError: (m: string) => void }) {
  const [texto, setTexto] = useState(h.titulo);
  const [enfocado, setEnfocado] = useState(false);
  // Si el título cambia desde otra pantalla se refleja, salvo que se esté escribiendo aquí.
  useEffect(() => { if (!enfocado) setTexto(h.titulo); }, [h.titulo, enfocado]);
  const minuto = minutoDe(h);
  const guardar = () => { setEnfocado(false); if (texto.trim() !== h.titulo) void api.titularHighlight(sid, h.id, texto).catch(() => onError('No se pudo guardar el título')); };
  return (
    <li data-testid="highlight" className="flex flex-col gap-1 rounded-xl bg-white px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Star size={13} className="text-[#8a6a00]" aria-hidden="true" />
          <span data-testid="highlight-minuto" className="tabular-nums">{minuto ?? fechaYHora(h.en).slice(11)}</span>
          {minuto === null && <span className="font-normal text-tenue">(sin EN VIVO)</span>}
        </span>
        <button data-testid="highlight-borrar" aria-label="Borrar este highlight" title="Borrar" onClick={() => { if (confirm('¿Borrar este highlight?')) void api.borrarHighlight(sid, h.id).catch(() => onError('No se pudo borrar')); }}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-gris-boton text-teal"><Trash2 size={13} aria-hidden="true" /></button>
      </div>
      <input data-testid="highlight-titulo" value={texto} maxLength={MAX_TITULO_HIGHLIGHT} placeholder="Sin título"
        onFocus={() => setEnfocado(true)} onChange={(e) => setTexto(e.target.value)} onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="h-8 w-full rounded-lg border border-borde bg-fondo px-2 text-[13px]" />
      <span className="text-[11px] text-tenue">Marcó {h.porNombre}</span>
    </li>
  );
}

/** Los momentos marcados con el botón dorado (o la tecla H). Solo los ve el equipo. */
export function PanelHighlights({ sid, nombreSesion, highlights, onError }: { sid: string; nombreSesion: string; highlights: HighlightPublico[]; onError: (m: string) => void }) {
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([aCsv(highlights)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = nombreDeArchivo(nombreSesion);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const recientesPrimero = [...highlights].reverse();
  return (
    <section className="flex h-[22rem] flex-col rounded-2xl border border-borde bg-tarjeta p-3" data-testid="panel-highlights">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><Star size={14} className="text-[#8a6a00]" aria-hidden="true" />Highlights <span className="rounded-md bg-teal-claro px-2 py-0.5 text-[11px] text-teal" data-testid="highlights-cuenta">{highlights.length}</span></h2>
        <button data-testid="highlights-exportar" onClick={exportar} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gris-boton px-2.5 text-[12px] font-semibold text-teal"><Download size={13} aria-hidden="true" />Exportar</button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl bg-fondo p-2">
        {recientesPrimero.length === 0 && <li className="m-auto px-2 text-center text-[12px] text-tenue">Pulsa «Highlight» o la tecla H para marcar un momento. Después le pones título.</li>}
        {recientesPrimero.map((h) => <Fila key={h.id} sid={sid} h={h} onError={onError} />)}
      </ul>
      <p className="mt-1.5 text-[11px] text-tenue">Solo el equipo los ve. Los títulos con IA llegarán cuando haya transcripción.</p>
    </section>
  );
}
