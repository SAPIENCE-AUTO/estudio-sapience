import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Room, Track, type RemoteAudioTrack } from 'livekit-client';
import { ArrowRightLeft, BellRing, Copy, DoorOpen, EyeOff, LayoutGrid, Mic, MicOff, Video as IconoVideo, VideoOff } from 'lucide-react';
import type { Diseno, EstadoEquipo, ParticipantePublico, TipoDiseno } from '../../compartido/tipos';
import { api } from '../lib/api';
import { useConsola, type Accion } from '../lib/useConsola';
import { camaraDe, proteger, useCambiosDeSala } from '../lib/sala';
import { Mosaico } from '../components/Mosaico';
import { Lienzo, type Viñeta } from '../components/Lienzo';
import { useVistaPrevia } from '../lib/medios';
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
function Tarjeta({ titulo, cuenta, aviso, icono, children, className }: { titulo: string; cuenta?: number; aviso?: React.ReactNode; icono?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-borde bg-tarjeta p-4 ${className ?? ''}`}>
      <h2 className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold">
        <span className="inline-flex items-center gap-1.5">{icono}{titulo}</span>
        <span className="inline-flex items-center gap-1.5">{aviso}{cuenta !== undefined && <span className="rounded-md bg-teal-claro px-2 py-0.5 text-[11px] text-teal">{cuenta}</span>}</span>
      </h2>
      {children}
    </section>
  );
}
const Boton = ({ principal, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { principal?: boolean }) => (
  <button {...p} className={`h-9 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold ${principal ? 'bg-teal text-white' : 'bg-gris-boton text-teal'} ${p.className ?? ''}`} />
);

/** Indicador con ícono y texto (nunca solo color): rojo = requiere atención, azul oscuro = sala verde. */
function Indicador({ tono, icono: Icono, children, ...resto }: { tono: 'atencion' | 'sala' | 'neutro'; icono: typeof BellRing; children: React.ReactNode; 'data-testid'?: string }) {
  const estilos = { atencion: 'bg-atencion text-white', sala: 'bg-sala text-white', neutro: 'bg-teal-claro text-teal' }[tono];
  return <span {...resto} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-semibold ${estilos}`}><Icono size={12} aria-hidden="true" />{children}</span>;
}

/** Mic y cámara: círculo azul oscuro encendido, rojo sólido apagado. El ícono cambia (tachado), así que no depende solo del color. */
function BotonControl({ activo, encendido, apagado, onClick, ...resto }: {
  activo: boolean; encendido: { icono: React.ReactNode; texto: string }; apagado: { icono: React.ReactNode; texto: string }; onClick: () => void; 'data-testid'?: string;
}) {
  const e = activo ? encendido : apagado;
  return (
    <button {...resto} aria-pressed={!activo} title={e.texto} onClick={onClick}
      aria-label={e.texto}
      className={`flex h-12 w-12 items-center justify-center rounded-full text-white ${activo ? 'bg-teal hover:bg-[#0b3140]' : 'bg-peligro hover:bg-[#9f1818]'}`}>{e.icono}</button>
  );
}

/** Cubre la viñeta: un clic la mueve (subir, bajar, ir a backstage). Al pasar el mouse dice qué va a pasar. */
function ClicParaMover({ texto, onClick, ...resto }: { texto: string; onClick: () => void; 'data-testid'?: string }) {
  return (
    <button {...resto} onClick={onClick} aria-label={texto} className="group absolute inset-0 z-[1] flex items-center justify-center bg-teal/0 transition-colors hover:bg-teal/45 focus-visible:bg-teal/45">
      <span className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{texto}</span>
    </button>
  );
}

/** Quitar o permitir el micrófono de un participante. Permitirlo no lo enciende: él decide cuándo hablar. */
function BotonMicrofono({ p, sid, onError }: { p: ParticipantePublico; sid: string; onError: (m: string) => void }) {
  const titulo = p.silenciado ? `Permitir que ${p.nombre} hable` : `Silenciar a ${p.nombre}`;
  return (
    <button data-testid={`silenciar-${p.nombre}`} aria-label={titulo} title={titulo}
      onClick={() => void api.silenciar(sid, p.id, !p.silenciado).catch(() => onError('No se pudo cambiar el micrófono'))}
      className={`absolute left-2 top-2 z-[2] inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ${p.silenciado ? 'bg-peligro text-white' : 'bg-white text-teal'}`}>
      {p.silenciado ? <><MicOff size={12} aria-hidden="true" />Sin micrófono</> : <Mic size={12} aria-hidden="true" />}
    </button>
  );
}

const DISENOS: { tipo: TipoDiseno; nombre: string }[] = [
  { tipo: 'auto', nombre: 'Cuadrícula automática' },
  { tipo: 'foco', nombre: 'Foco en una persona' },
  { tipo: 'lado', nombre: 'Lado a lado' },
  { tipo: 'redondas', nombre: 'Viñetas redondas' },
];

/** Dibujito de cada diseño, para elegirlo de un vistazo. */
function Miniatura({ tipo }: { tipo: TipoDiseno }) {
  const c = 'rounded-[2px] bg-silueta';
  return (
    <div className="relative flex aspect-video w-full gap-[3px] rounded-md bg-video p-[3px]">
      {tipo === 'auto' && <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[3px]">{[0, 1, 2, 3].map((i) => <div key={i} className={c} />)}</div>}
      {tipo === 'lado' && <><div className={`flex-1 ${c}`} /><div className={`flex-1 ${c}`} /></>}
      {tipo === 'foco' && <><div className={`flex-[3] ${c}`} /><div className="flex flex-1 flex-col gap-[3px]">{[0, 1, 2].map((i) => <div key={i} className={`flex-1 ${c}`} />)}</div></>}
      {tipo === 'redondas' && <><div className={`flex-1 ${c}`} /><div className="absolute bottom-1 right-1 flex gap-[2px]">{[0, 1].map((i) => <div key={i} className="h-2.5 w-2.5 rounded-full border border-white bg-silueta" />)}</div></>}
    </div>
  );
}

/** Botón «Diseño» con su ventana: elige cómo se acomoda el escenario y a quién se pone grande. Lo ven todos igual. */
function SelectorDiseno({ diseno, personas, onElegir }: { diseno: Diseno; personas: { id: string; nombre: string }[]; onElegir: (tipo: TipoDiseno, fijado: string | null) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  const actual = DISENOS.find((d) => d.tipo === diseno.tipo)?.nombre ?? '';
  const usaFijado = diseno.tipo === 'foco' || diseno.tipo === 'redondas';
  return (
    <div className="relative" ref={caja}>
      <button data-testid="boton-diseno" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-gris-boton px-3 text-[13px] font-semibold text-teal">
        <LayoutGrid size={14} aria-hidden="true" />Diseño: {actual}
      </button>
      {abierto && (
        <div role="dialog" aria-label="Diseño del escenario" className="absolute bottom-full left-1/2 z-20 mb-2 w-[300px] -translate-x-1/2 rounded-2xl border border-borde bg-tarjeta p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            {DISENOS.map((d) => (
              <button key={d.tipo} data-testid={`diseno-${d.tipo}`} onClick={() => onElegir(d.tipo, diseno.fijado)}
                className={`flex flex-col gap-1.5 rounded-xl border p-2 text-left text-[12px] font-semibold ${diseno.tipo === d.tipo ? 'border-teal bg-teal-claro' : 'border-borde'}`}>
                <Miniatura tipo={d.tipo} />{d.nombre}
              </button>
            ))}
          </div>
          <label className={`mt-3 flex flex-col gap-1 text-[12px] font-semibold ${usaFijado ? '' : 'opacity-50'}`}>Quién va grande
            <select data-testid="fijar" disabled={!usaFijado} value={diseno.fijado ?? ''} onChange={(e) => onElegir(diseno.tipo, e.target.value || null)} className="h-9 rounded-lg border border-borde-fuerte bg-white px-2 text-[13px] font-normal">
              <option value="">El primero del escenario</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          {!usaFijado && <p className="mt-1 text-[11px] text-tenue">Solo aplica en «Foco» y «Viñetas redondas».</p>}
        </div>
      )}
    </div>
  );
}

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
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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
      await salaSesion.localParticipant.setMicrophoneEnabled(micOn).catch(() => undefined);
      await salaSesion.localParticipant.setCameraEnabled(camOn).catch(() => undefined);
    })();
    return () => { cancelado = true; };
  }, [salaSesion, salaSesionLista, enEscenario, equipoIds, enVerdeConmigo, yo, micOn, camOn]);

  // Fuera del escenario y sin hablar con nadie en la sala verde no se publica nada, pero la persona del equipo se sigue viendo (opaca) en backstage.
  const publica = enEscenario || enVerdeConmigo !== '';
  const vistaPrevia = useVistaPrevia(undefined, !publica && camOn);

  if (!estado) return <div className="p-6 text-sm text-tenue">Conectando…</div>;

  const delLobby = participantes.filter((p) => p.lugar === 'lobby');
  const enVerde = participantes.filter((p) => p.lugar === 'verde');
  const enBackstage = participantes.filter((p) => p.lugar === 'backstage');
  const enPantalla = participantes.filter((p) => p.lugar === 'escenario');
  const nombreEquipo = (id: string | null) => estado.equipo.find((m) => m.id === id)?.nombre ?? 'el equipo';

  // Una pista propia SILENCIADA (la cámara se apagó al salir del escenario) sigue existiendo pero solo da cuadros negros: no se dibuja.
  const pubCamara = salaSesion?.localParticipant.getTrackPublication(Track.Source.Camera);
  const miCamara = pubCamara && !pubCamara.isMuted ? pubCamara.track ?? null : null;
  const alternarEscenario = () => void api.miembroEnEscenario(sid, !enEscenario).catch(() => setAviso('No se pudo cambiar'));

  // Quién va en el escenario: el equipo y los participantes que subieron. El acomodo cambia solo según cuántos son.
  const enEscena: Viñeta[] = [
    ...estado.equipo.filter((m) => m.enEscenario).map((m) => ({
      id: m.id,
      nodo: (
        <Mosaico nombre={m.nombre} esYo={m.id === yo} pista={m.id === yo ? miCamara : camaraDe(salaSesion, m.id)} espejo={m.id === yo} className="h-full w-full">
          {m.id === yo && <ClicParaMover data-testid="ir-backstage" texto="Clic para ir a backstage" onClick={alternarEscenario} />}
        </Mosaico>
      ),
    })),
    ...enPantalla.map((p) => ({
      id: p.id,
      nodo: (
        <Mosaico nombre={p.nombre} pista={camaraDe(salaSesion, p.id)} className="h-full w-full">
          <ClicParaMover data-testid={`bajar-${p.nombre}`} texto="Clic para bajar a backstage" onClick={() => ejecutar('bajar', p.id)} />
          <BotonMicrofono p={p} sid={sid} onError={setAviso} />
        </Mosaico>
      ),
    })),
  ];

  return (
    <div className="flex h-full flex-col" data-testid="consola" data-sesion-terminada={estado.sesion.terminada}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde bg-tarjeta px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[15px] font-semibold" data-testid="nombre-sesion">{estado.sesion.nombre}</h1>
          <span title={conectado ? 'Conectado' : 'Reconectando…'} className={`inline-block h-2.5 w-2.5 rounded-full ${conectado ? 'bg-ok' : 'bg-aviso'}`} />
          {delLobby.length > 0 && <Indicador tono="atencion" icono={BellRing} data-testid="indicador-lobby">{delLobby.length} en el lobby</Indicador>}
          {enVerde.length > 0 && <Indicador tono="sala" icono={DoorOpen} data-testid="indicador-verde">{enVerde.length} en la sala verde</Indicador>}
        </div>
        <div className="flex items-center gap-2">
          <Boton onClick={() => void navigator.clipboard?.writeText(`${location.origin}/p/${estado.sesion.codigo}`).then(() => setAviso('Link de participantes copiado'))} data-testid="copiar-link">
            <span className="inline-flex items-center gap-1.5"><Copy size={14} />Link de participantes</span>
          </Boton>
          <Boton data-testid="terminar" onClick={() => { if (confirm('¿Terminar la sesión para todos?')) void api.terminar(sid); }} className="!bg-peligro-fondo !text-peligro">Terminar sesión</Boton>
        </div>
      </header>

      {sonidosDe(salaSesion).map((t) => <AudioRemoto key={t.sid} pista={t} />)}

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="grid shrink-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="flex min-w-0 flex-col gap-3">
            <div className="mx-auto w-full" style={{ maxWidth: 'calc((100vh - 400px) * 16 / 9)', minWidth: 360 }}>
              <Lienzo data-testid="lista-escenario" items={enEscena} diseno={estado.diseno} vacio="Nadie en el escenario" />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2" data-testid="controles">
              <BotonControl data-testid="boton-mic" activo={micOn} encendido={{ icono: <Mic size={22} aria-hidden="true" />, texto: 'Silenciar mi micrófono' }} apagado={{ icono: <MicOff size={22} aria-hidden="true" />, texto: 'Activar mi micrófono' }} onClick={() => setMicOn(!micOn)} />
              <BotonControl data-testid="boton-cam" activo={camOn} encendido={{ icono: <IconoVideo size={22} aria-hidden="true" />, texto: 'Apagar mi cámara' }} apagado={{ icono: <VideoOff size={22} aria-hidden="true" />, texto: 'Encender mi cámara' }} onClick={() => setCamOn(!camOn)} />
              <SelectorDiseno diseno={estado.diseno} personas={enEscena.map((v) => ({ id: v.id, nombre: estado.equipo.find((m) => m.id === v.id)?.nombre ?? participantes.find((p) => p.id === v.id)?.nombre ?? '' }))}
                onElegir={(tipo, fijado) => void api.diseno(sid, tipo, fijado).catch(() => setAviso('No se pudo cambiar el diseño'))} />
              <Boton data-testid="mi-escenario" onClick={alternarEscenario}>
                <span className="inline-flex items-center gap-1.5"><ArrowRightLeft size={14} aria-hidden="true" />{enEscenario ? 'Ir a backstage' : 'Subirme al escenario'}</span>
              </Boton>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-3">
            <Tarjeta titulo="Lobby" cuenta={delLobby.length} aviso={delLobby.length > 0 ? <Indicador tono="atencion" icono={BellRing}>Esperan</Indicador> : undefined}>
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

            <Tarjeta titulo="Sala verde" cuenta={enVerde.length} aviso={enVerde.length > 0 ? <Indicador tono="sala" icono={DoorOpen}>Adentro</Indicador> : undefined}>
              <div className="flex flex-col gap-4" data-testid="lista-verde">
                {enVerde.length === 0 && <p className="text-[13px] text-tenue">Nadie en la sala verde</p>}
                {enVerde.map((p) => <PanelVerde key={p.id} p={p} room={salaSesion ?? undefined} yo={yo} ejecutar={ejecutar} />)}
                {enVerde.some((p) => p.verdeCon !== yo) && <p className="text-[12px] text-tenue">{`Con ${nombreEquipo(enVerde.find((p) => p.verdeCon !== yo)?.verdeCon ?? null)}`}</p>}
              </div>
            </Tarjeta>
          </aside>
        </div>

        <Tarjeta className="shrink-0" titulo="Backstage: solo lo ve el equipo" cuenta={enBackstage.length} icono={<EyeOff size={14} aria-hidden="true" />}>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex flex-wrap items-start gap-3" data-testid="lista-backstage">
              {!enBackstage.length && <p className="text-[13px] text-tenue">Nadie en backstage</p>}
              {enBackstage.map((p) => (
                <div key={p.id} className="flex w-52 flex-col gap-1.5" data-testid={`tarjeta-backstage-${p.nombre}`}>
                  <Mosaico nombre={p.nombre} pista={camaraDe(salaSesion, p.id)} className="aspect-video rounded-xl">
                    <ClicParaMover data-testid={`subir-${p.nombre}`} texto="Clic para subir al escenario" onClick={() => ejecutar('subir', p.id)} />
                    <BotonMicrofono p={p} sid={sid} onError={setAviso} />
                    {!p.conectado && <span className="absolute right-2 top-2 z-[2] rounded-md bg-peligro-fondo px-1.5 py-0.5 text-[10px] font-semibold text-peligro"><MicOff size={10} className="mr-1 inline" />Sin conexión</span>}
                  </Mosaico>
                  <div className="flex gap-1.5">
                    <Boton data-testid={`verde-${p.nombre}`} className="flex-1" onClick={() => ejecutar('llamar', p.id)} title="Regresar a la sala verde">Sala verde</Boton>
                    <Boton data-testid={`lobby-${p.nombre}`} className="flex-1" onClick={() => ejecutar('lobby', p.id)} title="Regresar al lobby">Lobby</Boton>
                  </div>
                </div>
              ))}
            </div>
            {!enEscenario && miembro && (
              <div className="flex w-52 flex-col gap-1.5" data-testid="mi-vineta-backstage">
                <Mosaico nombre={miembro.nombre} esYo flujo={vistaPrevia} pista={miCamara} espejo className="aspect-video rounded-xl">
                  <div className="pointer-events-none absolute inset-0 bg-white/55" aria-hidden="true" />
                  <ClicParaMover data-testid="volver-escenario" texto="Clic para volver al escenario" onClick={alternarEscenario} />
                </Mosaico>
                <p className="text-[12px] text-tenue">Tú: haz clic en tu viñeta para volver al escenario.</p>
              </div>
            )}
          </div>
        </Tarjeta>
      </main>

      {aviso && (
        <button onClick={limpiarAviso} className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-teal px-4 py-2 text-[13px] font-medium text-white shadow-lg" role="status" data-testid="aviso">{aviso}</button>
      )}
    </div>
  );
}
