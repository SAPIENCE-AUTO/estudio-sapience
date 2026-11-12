import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ResumenSesion } from '../lib/api';
import { cerrarSesionEquipo, configPublica } from '../lib/acceso';

/** Entrada del equipo: sus sesiones y el botón para crear una nueva. (El Hub también las puede crear por API.) */
export default function Inicio() {
  const [sesiones, setSesiones] = useState<ResumenSesion[] | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conLogin, setConLogin] = useState(false);
  useEffect(() => { void configPublica().then((c) => setConLogin(c.authMode === 'supabase')).catch(() => undefined); }, []);

  const cargar = () => api.sesiones().then(setSesiones).catch((e: Error) => setError(e.message));
  useEffect(() => { void cargar(); }, []);

  async function crear() {
    setError(null);
    try { await api.crearSesion(nombre.trim()); setNombre(''); await cargar(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-5 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Talks</h1>
        {conLogin && <button data-testid="salir" className="text-[13px] font-semibold text-tenue underline underline-offset-2" onClick={() => void cerrarSesionEquipo()}>Salir</button>}
      </div>
      <div className="flex gap-3 rounded-2xl border border-borde bg-tarjeta p-4">
        <input data-testid="nueva-sesion" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la sesión"
          className="h-11 flex-1 rounded-xl border border-borde-fuerte px-3 text-[15px]" onKeyDown={(e) => { if (e.key === 'Enter' && nombre.trim()) void crear(); }} />
        <button data-testid="crear" disabled={!nombre.trim()} onClick={() => void crear()} className="h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-white">Crear</button>
      </div>
      {error && <p className="text-[13px] text-peligro" role="alert">{error}</p>}
      <ul className="flex flex-col gap-3">
        {sesiones?.length === 0 && <li className="text-sm text-tenue">Todavía no hay sesiones.</li>}
        {sesiones?.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 rounded-2xl border border-borde bg-tarjeta p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold">{s.nombre}</span>
              <Link to={`/equipo/${s.id}`} className="rounded-lg bg-teal px-3 py-1.5 text-[13px] font-semibold text-white">Abrir consola</Link>
            </div>
            <span className="break-all text-[12px] text-tenue">{s.linkParticipantes}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
