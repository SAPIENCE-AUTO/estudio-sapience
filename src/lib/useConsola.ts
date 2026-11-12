// Estado de la consola del equipo. Lo que ve el equipo es el estado del servidor MÁS parches optimistas:
// al hacer clic el mosaico se mueve al instante (0 ms) y el parche se retira cuando llega la versión que lo confirma.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoEquipo, Lugar, ParticipantePublico } from '../../compartido/tipos';
import { api, ErrorApi } from './api';
import { useCanal } from './canal';
import { traza } from './traza';

export type Accion = 'llamar' | 'pasar' | 'lobby' | 'subir' | 'bajar';

interface Parche { lugar: Lugar; verdeCon: string | null; hastaV: number | null; seq: number; t: number }

const destinoDe = (accion: Accion, yo: string): { lugar: Lugar; verdeCon: string | null } => {
  switch (accion) {
    case 'llamar': return { lugar: 'verde', verdeCon: yo };
    case 'pasar': return { lugar: 'backstage', verdeCon: null };
    case 'lobby': return { lugar: 'lobby', verdeCon: null };
    case 'subir': return { lugar: 'escenario', verdeCon: null };
    case 'bajar': return { lugar: 'backstage', verdeCon: null };
  }
};

export function useConsola(sid: string) {
  const { estado, conectado } = useCanal<EstadoEquipo>({ rol: 'equipo', sid });
  const [parches, setParches] = useState<Record<string, Parche>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const vistaMax = useRef(0);
  const seq = useRef(0);

  // Cada vez que llega un estado nuevo se retiran los parches que ya confirmó (o los que llevan demasiado esperando).
  useEffect(() => {
    if (!estado) return;
    vistaMax.current = Math.max(vistaMax.current, estado.v);
    setParches((previos) => {
      const ahora = Date.now();
      const vivos: Record<string, Parche> = {};
      for (const [pid, p] of Object.entries(previos)) {
        const confirmado = p.hastaV !== null && estado.v >= p.hastaV;
        if (!confirmado && ahora - p.t < 10000) vivos[pid] = p;
      }
      return Object.keys(vivos).length === Object.keys(previos).length ? previos : vivos;
    });
  }, [estado]);

  const participantes: ParticipantePublico[] = useMemo(
    () => (estado?.participantes ?? []).map((p) => (parches[p.id] ? { ...p, lugar: parches[p.id].lugar, verdeCon: parches[p.id].verdeCon } : p)),
    [estado, parches],
  );

  const ejecutar = useCallback(async (accion: Accion, pid: string) => {
    if (!estado) return;
    const mio = ++seq.current;
    traza('clic', { accion, pid });
    setParches((p) => ({ ...p, [pid]: { ...destinoDe(accion, estado.yo), hastaV: null, seq: mio, t: Date.now() } }));
    try {
      const { v } = await api.accion(sid, pid, accion);
      setParches((p) => {
        const actual = p[pid];
        if (!actual || actual.seq !== mio) return p; // ya hubo otra acción sobre la misma persona: esa manda
        if (vistaMax.current >= v) { const { [pid]: _quitado, ...resto } = p; return resto; }
        return { ...p, [pid]: { ...actual, hastaV: v } };
      });
    } catch (e) {
      setParches((p) => { if (p[pid]?.seq !== mio) return p; const { [pid]: _quitado, ...resto } = p; return resto; });
      setAviso(e instanceof ErrorApi ? e.message : 'No se pudo hacer el cambio');
    }
  }, [estado, sid]);

  return { estado, conectado, participantes, ejecutar, aviso, limpiarAviso: () => setAviso(null), setAviso };
}
