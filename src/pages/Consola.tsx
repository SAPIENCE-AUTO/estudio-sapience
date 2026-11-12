import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Room, Track, type RemoteAudioTrack } from 'livekit-client';
import { Copy, MicOff } from 'lucide-react';
import type { EstadoEquipo, ParticipantePublico } from '../../compartido/tipos';
import { api } from '../lib/api';
import { useConsola, type Accion } from '../lib/useConsola';
import { camaraDe, proteger, useCambiosDeSala } from '../lib/sala';
import { Mosaico } from '../components/Mosaico';
import { AudioRemoto } from '../components/Video';

// ───────── Conexiones de LiveKit del equipo ─────────
/** La sala de la sesión (la única): aquí el equipo recibe a todos, también a quienes están en la sala verde, en backstage y en el escenario. */
function useSalaSesion(sid: string, listo: boolean): Room | null {
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => {
    if (!listo) return;
    let cancelado = false;
    const r = new Room({ adaptiveStream: false, dynacast: false });
    void (async () => {
      try {
        const t = await api.tokenEquipo(sid);
        if (cancelado) return;
        await r.connect(t.url, t.token, { autoSubscribe: true });
        if (!cancelado) setRoom(r);
      } catch { /* la consola vuelve a intentar al recargar */ }
    })();
    return () => { cancelado = true; setRoom(null); void r.disconnect(); };
  }, [sid, listo]);
  return room;
}

function sonidosDe(room: Room | null): RemoteAudioTrack[] {
  return room ? ([...room.remoteParticipants.values()].map((p) => p.getTrackPublication(Track.Source.Microphone)?.track).filter(Boolean) as RemoteAudioTrack[]) : [];
}

const minutos = (desde: number, ahora: number) => Math.max(0, Math.floor((ahora - desde) / 60000));

// ───────── Piezas de la pantalla ─────────
function Tarjeta({ titulo, cuenta, children, className }: { titulo: string; cuenta?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-borde bg-tarjeta p-4 ${className ?? ''}`}>
      <h2 className="mb-3 flex items-center justify-between text-[13px] font-semibold">{titulo}{cuenta !== undefined && <span className="rounded-md bg-teal-claro px-2 py-0.5 text-[11px] text-teal">{cuenta}</span>}</h2>
      {children}
    </section>
  );
}
const Boton = ({ principal, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { principal?: boolean }) => (
  <button {...p} className={`h-9 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold ${principal ? 'bg-teal text-white' : 'bg-gris-boton text-teal'} ${p.className ?? ''}`} />
);

function PanelVerde({ p, room, yo, ejecutar }: { p: ParticipantePublico; room: Room | undefined; yo: string; ejecutar: (a: Accion, pid: string) => void }) {
  useCambiosDeSala(room ?? null);
  return (
    <div className="flex flex-col gap-2" data-testid={`panel-verde-${p.nombre}`}>
      <Mosaico nombre={p.nombre} pista={room ? camaraDe(room, p.id) : null} className="aspect-video w-full rounded-xl" />
      {sonidosDe(room ?? null).map((t) => <AudioRemoto key={t.sid} pista={t} />)}
      <div className="flex gap-2">
        <Boton principal data-testid={`pasar-${p.nombre}`} className="flex-1" onClick={() => ejecutar('pasar', p.id)}>Pasar a la sesión</Boton>
        <Boton data-testid={`lobby-${p.nombre}`} onClick={() => ejecutar('lobby', p.id)}>Regresar al lobby</Boton>
      </div>
      {p.verdeCon !== yo && <p className="text-[12px] text-tenue">Lo tiene otra persona del equipo</p>}
    </div>
  );
}

export default function Consola() {
  const { sid = '' } = useParams();
  const { estado, conectado, participantes, ejecutar, aviso, limpiarAviso, setAviso } = useConsola(sid);
  const salaSesion = useSalaSesion(sid, !!estado);
  useCambiosDeSala(salaSesion);
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);

  const yo = estado?.yo ?? '';
  const miembro = estado?.equipo.find((m) => m.id === yo);
  const equipoIds = useMemo(() => (estado?.equipo ?? []).map((m) => m.id).sort().join(','), [estado?.equipo]);
  const enEscenario = !!miembro?.enEscenario;
  const salaSesionLista = !!salaSesion && salaSesion.state === 'connected';

  // El equipo publica solo cuando hace falta: en el escenario (lo recibe cualquiera) o hablando con alguien en la sala verde (solo esa persona
  // y el resto del equipo). Siempre se protegen las pistas ANTES de publicar. Se usa el estado del servidor, no el parche optimista.
  const enVerdeConmigo = (estado?.participantes ?? []).filter((p) => p.lugar === 'verde' && p.verdeCon === yo).map((p) => p.id).sort().join(',');
  useEffect(() => {
    if (!salaSesion || !salaSesionLista) return;
    let cancelado = false;
    const otrosDelEquipo = (equipoIds ? equipoIds.split(',') : []).filter((id) => id !== yo);
    const deVerde = enVerdeConmigo ? enVerdeConmigo.split(',') : [];
    void (async () => {
      proteger(salaSesion, enEscenario ? 'todos' : [...otrosDelEquipo, ...deVerde]);
      if (!enEscenario && deVerde.length === 0) {
        await salaSesion.localParticipant.setCameraEnabled(false).catch(() => undefined);
        await salaSesion.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        return;
      }
      if (cancelado) return;
      await salaSesion.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      await salaSesion.localParticipant.setCameraEnabled(true).catch(() => undefined);
    })();
    return () => { cancelado = true; };
  }, [salaSesion, salaSesionLista, enEscenario, equipoIds, enVerdeConmigo, yo]);

  if (!estado) return <div className="p-6 text-sm text-tenue">Conectando…</div>;

  const delLobby = participantes.filter((p) => p.lugar === 'lobby');
  const enVerde = participantes.filter((p) => p.lugar === 'verde');
  const enBackstage = participantes.filter((p) => p.lugar === 'backstage');
  const enPantalla = participantes.filter((p) => p.lugar === 'escenario');
  const nombreEquipo = (id: string | null) => estado.equipo.find((m) => m.id === id)?.nombre ?? 'el equipo';

  return (
    <div className="flex h-full flex-col" data-testid="consola" data-sesion-terminada={estado.sesion.terminada}>
      <header className="flex items-center justify-between gap-4 border-b border-borde bg-tarjeta px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold" data-testid="nombre-sesion">{estado.sesion.nombre}</h1>
          <span title={conectado ? 'Conectado' : 'Reconectando…'} className={`inline-block h-2.5 w-2.5 rounded-full ${conectado ? 'bg-ok' : 'bg-aviso'}`} />
        </div>
        <div className="flex items-center gap-2">
          <Boton onClick={() => void navigator.clipboard?.writeText(`${location.origin}/p/${estado.sesion.codigo}`).then(() => setAviso('Link de participantes copiado'))} data-testid="copiar-link">
            <span className="inline-flex items-center gap-1.5"><Copy size={14} />Link de participantes</span>
          </Boton>
          <Boton data-testid="mi-escenario" onClick={() => void api.miembroEnEscenario(sid, !enEscenario).catch(() => setAviso('No se pudo cambiar'))}>
            {enEscenario ? 'Bajarme del escenario' : 'Subirme al escenario'}
          </Boton>
          <Boton data-testid="terminar" onClick={() => { if (confirm('¿Terminar la sesión para todos?')) void api.terminar(sid); }} className="!bg-peligro-fondo !text-peligro">Terminar sesión</Boton>
        </div>
      </header>

      {sonidosDe(salaSesion).map((t) => <AudioRemoto key={t.sid} pista={t} />)}

      <main className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-4 p-4">
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Tarjeta titulo="Lobby" cuenta={delLobby.length}>
            <ul className="flex flex-col gap-2" data-testid="lista-lobby">
              {delLobby.length === 0 && <li className="text-[13px] text-tenue">Nadie esperando</li>}
              {delLobby.map((p) => (
                <li key={p.id} data-testid={`fila-lobby-${p.nombre}`} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">{p.nombre}</span>
                    <span className="text-[11px] text-tenue">{p.conectado ? `hace ${minutos(p.entroEn, ahora)} min` : 'Sin conexión'}</span>
                  </div>
                  <Boton principal data-testid={`llamar-${p.nombre}`} disabled={!p.conectado} onClick={() => ejecutar('llamar', p.id)}>Llamar</Boton>
                </li>
              ))}
            </ul>
          </Tarjeta>

          <Tarjeta titulo="Sala verde" cuenta={enVerde.length}>
            <div className="flex flex-col gap-4" data-testid="lista-verde">
              {enVerde.length === 0 && <p className="text-[13px] text-tenue">Nadie en la sala verde</p>}
              {enVerde.map((p) => <PanelVerde key={p.id} p={p} room={salaSesion ?? undefined} yo={yo} ejecutar={ejecutar} />)}
              {enVerde.some((p) => p.verdeCon !== yo) && <p className="text-[12px] text-tenue">{`Con ${nombreEquipo(enVerde.find((p) => p.verdeCon !== yo)?.verdeCon ?? null)}`}</p>}
            </div>
          </Tarjeta>
        </aside>

        <section className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Tarjeta titulo="Escenario" cuenta={enPantalla.length + (enEscenario ? 1 : 0)}>
            <div className="grid grid-cols-3 gap-2" data-testid="lista-escenario">
              {!enPantalla.length && !enEscenario && <p className="col-span-3 text-[13px] text-tenue">Nadie en el escenario</p>}
              {estado.equipo.filter((m) => m.enEscenario).map((m) => (
                <Mosaico key={m.id} nombre={m.nombre} esYo={m.id === yo} pista={m.id === yo ? salaSesion?.localParticipant.getTrackPublication(Track.Source.Camera)?.track : camaraDe(salaSesion, m.id)} espejo={m.id === yo} className="aspect-video rounded-xl" />
              ))}
              {enPantalla.map((p) => (
                <Mosaico key={p.id} nombre={p.nombre} pista={camaraDe(salaSesion, p.id)} className="aspect-video rounded-xl">
                  <button data-testid={`bajar-${p.nombre}`} onClick={() => ejecutar('bajar', p.id)} className="absolute bottom-2 right-2 h-7 rounded-md bg-teal px-2.5 text-[11px] font-semibold text-white">Bajar</button>
                </Mosaico>
              ))}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Backstage" cuenta={enBackstage.length}>
            <div className="grid grid-cols-3 gap-3" data-testid="lista-backstage">
              {!enBackstage.length && <p className="col-span-3 text-[13px] text-tenue">Nadie en backstage</p>}
              {enBackstage.map((p) => (
                <div key={p.id} className="flex flex-col gap-1.5" data-testid={`tarjeta-backstage-${p.nombre}`}>
                  <Mosaico nombre={p.nombre} pista={camaraDe(salaSesion, p.id)} className="aspect-video rounded-xl">
                    {!p.conectado && <span className="absolute right-2 top-2 rounded-md bg-peligro-fondo px-1.5 py-0.5 text-[10px] font-semibold text-peligro"><MicOff size={10} className="mr-1 inline" />Sin conexión</span>}
                  </Mosaico>
                  <div className="flex gap-1.5">
                    <Boton principal data-testid={`subir-${p.nombre}`} className="flex-1" onClick={() => ejecutar('subir', p.id)}>Subir</Boton>
                    <Boton data-testid={`verde-${p.nombre}`} onClick={() => ejecutar('llamar', p.id)} title="Regresar a la sala verde">Verde</Boton>
                    <Boton data-testid={`lobby-${p.nombre}`} onClick={() => ejecutar('lobby', p.id)} title="Regresar al lobby">Lobby</Boton>
                  </div>
                </div>
              ))}
            </div>
          </Tarjeta>
        </section>
      </main>

      {aviso && (
        <button onClick={limpiarAviso} className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-teal px-4 py-2 text-[13px] font-medium text-white shadow-lg" role="status" data-testid="aviso">{aviso}</button>
      )}
    </div>
  );
}
