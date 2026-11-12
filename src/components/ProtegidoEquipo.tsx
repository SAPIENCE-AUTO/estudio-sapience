import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ErrorApi } from '../lib/api';
import { cerrarSesionEquipo, clienteSupabase, configPublica } from '../lib/acceso';
import Entrar from '../pages/Entrar';

type Fase = 'cargando' | 'libre' | 'entrar' | 'sin-acceso' | 'error';

function Centrado({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-5 py-10">{children}</div>;
}

/**
 * Deja pasar solo al equipo. En desarrollo (modo «dev») no pide nada; en producción pide la sesión por correo y
 * comprueba con el servidor que ese correo tenga acceso. Una vez adentro NUNCA se vuelve a tapar la pantalla por un
 * aviso repetido de Supabase (volver a la pestaña lo repite): solo se sale si de verdad cerró sesión.
 */
export default function ProtegidoEquipo({ children }: { children: React.ReactNode }) {
  const [fase, setFaseVista] = useState<Fase>('cargando');
  const [detalle, setDetalle] = useState('');
  const faseActual = useRef<Fase>('cargando');
  const setFase = (f: Fase) => { faseActual.current = f; setFaseVista(f); };

  const revisar = useCallback(async () => {
    try {
      const c = await configPublica();
      if (c.authMode !== 'supabase') { setFase('libre'); return; }
      const { data } = await (await clienteSupabase()).auth.getSession();
      if (!data.session) { setDetalle(''); setFase('entrar'); return; }
      await api.yo();
      setFase('libre');
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 401) { await cerrarSesionEquipo().catch(() => undefined); setDetalle(e.message); setFase('entrar'); }
      else if (e instanceof ErrorApi && e.estado === 403) setFase('sin-acceso');
      else { setDetalle(e instanceof Error ? e.message : ''); setFase('error'); }
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    let baja: (() => void) | undefined;
    void revisar();
    void (async () => {
      try {
        const c = await configPublica();
        if (c.authMode !== 'supabase' || !vivo) return;
        const { data } = (await clienteSupabase()).auth.onAuthStateChange((evento, sesion) => {
          // Fuera del aviso: Supabase no deja pedirle cosas a su propio cliente desde dentro de él.
          setTimeout(() => {
            if (!vivo) return;
            if (evento === 'SIGNED_OUT') setFase('entrar');
            else if (evento === 'SIGNED_IN' && sesion && faseActual.current !== 'libre') void revisar();
          }, 0);
        });
        baja = () => data.subscription.unsubscribe();
        if (!vivo) baja();
      } catch { /* sin configuración: ya lo muestra revisar() */ }
    })();
    return () => { vivo = false; baja?.(); };
  }, [revisar]);

  if (fase === 'libre') return <>{children}</>;
  if (fase === 'entrar') return <Entrar aviso={detalle || undefined} />;
  if (fase === 'sin-acceso') {
    return (
      <Centrado>
        <h1 className="text-xl font-semibold">Talks</h1>
        <div className="rounded-2xl border border-borde bg-tarjeta p-5" data-testid="sin-acceso">
          <h2 className="text-lg font-semibold">Este correo no tiene acceso</h2>
          <p className="mt-2 text-sm text-tenue">Pide que te agreguen al equipo, o entra con otro correo.</p>
          <button className="mt-4 h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-white" onClick={() => void cerrarSesionEquipo()}>Usar otro correo</button>
        </div>
      </Centrado>
    );
  }
  if (fase === 'error') {
    return (
      <Centrado>
        <h1 className="text-xl font-semibold">Talks</h1>
        <div className="rounded-2xl border border-borde bg-tarjeta p-5" data-testid="error-acceso">
          <h2 className="text-lg font-semibold">No pudimos verificar tu sesión</h2>
          {detalle && <p className="mt-2 text-sm text-tenue">{detalle}</p>}
          <button className="mt-4 h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-white" onClick={() => { setFase('cargando'); void revisar(); }}>Reintentar</button>
        </div>
      </Centrado>
    );
  }
  return <Centrado><p className="text-sm text-tenue">Cargando…</p></Centrado>;
}
