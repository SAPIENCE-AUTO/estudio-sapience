import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Room, Track, type RemoteAudioTrack } from 'livekit-client';
import { ArrowRightLeft, BellRing, Copy, DoorOpen, EyeOff, LayoutGrid, Mic, MicOff, Video as IconoVideo, VideoOff, WifiOff, X } from 'lucide-react';
import type { AjusteDiseno, Diseno, EstadoEquipo, FondoDiseno, FormaDiseno, ParticipantePublico, TipoDiseno } from '../../compartido/tipos';
import { tieneFoco } from '../lib/acomodo';
import { api } from '../lib/api';
import { useConsola, type Accion } from '../lib/useConsola';
import { camaraDe, proteger, useCambiosDeSala } from '../lib/sala';
import { Mosaico } from '../components/Mosaico';
import { Lienzo, type Viñeta } from '../components/Lienzo';
import { ChatConsola } from '../components/Chat';
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
function Tarjeta({ titulo, cuenta, aviso, icono, children, className, ...resto }: { titulo: string; cuenta?: number; aviso?: React.ReactNode; icono?: React.ReactNode; children: React.ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <section {...resto} className={`rounded-2xl border border-borde bg-tarjeta p-4 ${className ?? ''}`}>
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

/** Velo claro: así se ven las viñetas de backstage (el equipo las ve opacas) y las de quien se desconectó. */
const Velo = () => <div className="pointer-events-none absolute inset-0 bg-white/55" aria-hidden="true" />;

/** La persona se desconectó: lo dice con ícono y texto. Se le puede mover igual; si no regresa en un rato, el servidor la manda al lobby. */
function SinConexion() {
  return <span data-testid="sin-conexion" className="pointer-events-none absolute right-2 top-2 z-[2] inline-flex items-center gap-1 rounded-md bg-atencion px-1.5 py-0.5 text-[11px] font-semibold text-white"><WifiOff size={11} aria-hidden="true" />Sin conexión</span>;
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

const ACOMODOS: { tipo: TipoDiseno; nombre: string }[] = [
  { tipo: 'auto', nombre: 'Cuadrícula' },
  { tipo: 'foco', nombre: 'Foco, tira al lado' },
  { tipo: 'tira-abajo', nombre: 'Foco, tira abajo' },
  { tipo: 'lado', nombre: 'Lado a lado' },
  { tipo: 'fila', nombre: 'Fila centrada' },
  { tipo: 'redondas', nombre: 'Foco con viñetas flotantes' },
];
const FORMAS: { forma: FormaDiseno; nombre: string; clase: string }[] = [
  { forma: 'cuadrada', nombre: 'Cuadrada', clase: 'rounded-[2px]' },
  { forma: 'redondeada', nombre: 'Redondeada', clase: 'rounded-md' },
  { forma: 'circulo', nombre: 'Círculo', clase: 'rounded-full' },
];
const AJUSTES: { ajuste: AjusteDiseno; nombre: string }[] = [
  { ajuste: 'llenar', nombre: 'Llenar (recorta)' },
  { ajuste: 'completo', nombre: 'Completo (sin recortar)' },
];
const FONDOS: { fondo: FondoDiseno; nombre: string; color: string }[] = [
  { fondo: 'gris', nombre: 'Gris', color: '#dce8ec' },
  { fondo: 'blanco', nombre: 'Blanco', color: '#ffffff' },
  { fondo: 'negro', nombre: 'Negro', color: '#14181a' },
  { fondo: 'marca', nombre: 'Azul', color: '#0f3d4d' },
];

/** Dibujito de cada acomodo, para elegirlo de un vistazo. */
function Miniatura({ tipo }: { tipo: TipoDiseno }) {
  const c = 'rounded-[2px] bg-silueta';
  return (
    <div className="relative flex aspect-video w-full gap-[3px] rounded-md bg-video p-[3px]">
      {tipo === 'auto' && <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-[3px]">{[0, 1, 2, 3].map((i) => <div key={i} className={c} />)}</div>}
      {tipo === 'lado' && <><div className={`flex-1 ${c}`} /><div className={`flex-1 ${c}`} /></>}
      {tipo === 'foco' && <><div className={`flex-[3] ${c}`} /><div className="flex flex-1 flex-col gap-[3px]">{[0, 1, 2].map((i) => <div key={i} className={`flex-1 ${c}`} />)}</div></>}
      {tipo === 'tira-abajo' && <div className="flex flex-1 flex-col gap-[3px]"><div className={`flex-[3] ${c}`} /><div className="flex flex-1 gap-[3px]">{[0, 1, 2].map((i) => <div key={i} className={`flex-1 ${c}`} />)}</div></div>}
      {tipo === 'fila' && <div className="flex flex-1 items-center justify-center gap-[3px]">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-[85%] w-[16%] ${c}`} />)}</div>}
      {tipo === 'redondas' && <><div className={`flex-1 ${c}`} /><div className="absolute bottom-1 right-1 flex gap-[2px]">{[0, 1].map((i) => <div key={i} className="h-2.5 w-2.5 rounded-full border border-white bg-silueta" />)}</div></>}
    </div>
  );
}

/** Botón «Diseño» con su ventana: acomodo, forma de la viñeta, ajuste de la imagen, fondo y a quién se pone grande. Lo ven todos igual. */
function SelectorDiseno({ diseno, personas, onElegir }: { diseno: Diseno; personas: { id: string; nombre: string }[]; onElegir: (parche: Partial<Diseno>) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  const actual = ACOMODOS.find((d) => d.tipo === diseno.tipo)?.nombre ?? '';
  const usaFijado = tieneFoco(diseno.tipo);
  const opcion = (activa: boolean) => `rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${activa ? 'border-teal bg-teal-claro text-teal' : 'border-borde text-texto'}`;
  const titulo = 'mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-tenue';
  return (
    <div className="relative" ref={caja}>
      <button data-testid="boton-diseno" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-gris-boton px-3 text-[13px] font-semibold text-teal">
        <LayoutGrid size={14} aria-hidden="true" />Diseño: {actual}
      </button>
      {abierto && (
        <div role="dialog" aria-label="Diseño del escenario" className="fixed right-4 top-16 z-30 max-h-[calc(100vh-5rem)] w-[320px] overflow-y-auto rounded-2xl border border-borde bg-tarjeta p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold">Diseño del escenario</span>
            <button data-testid="cerrar-diseno" aria-label="Cerrar" onClick={() => setAbierto(false)} className="flex h-7 w-7 items-center justify-center rounded-md bg-gris-boton text-teal"><X size={14} aria-hidden="true" /></button>
          </div>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-tenue">Acomodo</h3>
          <div className="grid grid-cols-3 gap-2">
            {ACOMODOS.map((d) => (
              <button key={d.tipo} data-testid={`diseno-${d.tipo}`} onClick={() => onElegir({ tipo: d.tipo })}
                className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left text-[11px] font-semibold leading-tight ${diseno.tipo === d.tipo ? 'border-teal bg-teal-claro' : 'border-borde'}`}>
                <Miniatura tipo={d.tipo} />{d.nombre}
              </button>
            ))}
          </div>
          <h3 className={titulo}>Forma de la viñeta</h3>
          <div className="flex gap-2">
            {FORMAS.map((f) => (
              <button key={f.forma} data-testid={`forma-${f.forma}`} onClick={() => onElegir({ forma: f.forma })} className={`flex flex-1 flex-col items-center justify-center gap-1 ${opcion(diseno.forma === f.forma)}`}>
                <span className={`inline-block h-3.5 w-3.5 border-2 border-current ${f.clase}`} aria-hidden="true" />{f.nombre}
              </button>
            ))}
          </div>
          <h3 className={titulo}>Imagen</h3>
          <div className="flex gap-2">
            {AJUSTES.map((a) => <button key={a.ajuste} data-testid={`ajuste-${a.ajuste}`} onClick={() => onElegir({ ajuste: a.ajuste })} className={`flex-1 ${opcion(diseno.ajuste === a.ajuste)}`}>{a.nombre}</button>)}
          </div>
          <h3 className={titulo}>Fondo</h3>
          <div className="flex gap-2">
            {FONDOS.map((f) => (
              <button key={f.fondo} data-testid={`fondo-${f.fondo}`} onClick={() => onElegir({ fondo: f.fondo })} className={`flex flex-1 flex-col items-center justify-center gap-1 ${opcion(diseno.fondo === f.fondo)}`}>
                <span className="inline-block h-3.5 w-3.5 rounded-full border border-borde-fuerte" style={{ background: f.color }} aria-hidden="true" />{f.nombre}
              </button>
            ))}
          </div>
          <label className={`mt-3 flex flex-col gap-1 text-[12px] font-semibold ${usaFijado ? '' : 'opacity-50'}`}>Quién va grande
            <select data-testid="fijar" disabled={!usaFijado} value={diseno.fijado ?? ''} onChange={(e) => onElegir({ fijado: e.target.value || null })} className="h-9 rounded-lg border border-borde-fuerte bg-white px-2 text-[13px] font-normal">
              <option value="">El primero del escenario</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          {!usaFijado && <p className="mt-1 text-[11px] text-tenue">Solo aplica en los acomodos con foco.</p>}
        </div>
      )}
    </div>
  );
}

function PanelVerde({ p, room, yo, ejecutar }: { p: ParticipantePublico; room: Room | undefined; yo: string; ejecutar: (a: Accion, pid: string) => void }) {
  useCambiosDeSala(room ?? null);
  return (
    <div className="flex flex-col gap-2" data-testid={`panel-verde-${p.nombre}`}>
      <Mosaico nombre={p.nombre} pista={room ? camaraDe(room, p.id) : null} className="aspect-video w-full rounded-xl">{!p.conectado && <><Velo /><SinConexion /></>}</Mosaico>
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
  // Dos cambios de diseño muy seguidos no deben pisarse: cada uno parte de lo último que se pidió, no de lo último que llegó.
  const disenoPedido = useRef<Diseno | null>(null);
  const disenosEnVuelo = useRef(0);
  const disenoDelServidor = JSON.stringify(estado?.diseno ?? null);
  useEffect(() => { if (disenosEnVuelo.current === 0) disenoPedido.current = estado?.diseno ?? null; }, [disenoDelServidor]); // eslint-disable-line react-hooks/exhaustive-deps
  const elegirDiseno = (parche: Partial<Diseno>) => {
    const base = disenoPedido.current ?? estado?.diseno;
    if (!base) return;
    const nuevo = { ...base, ...parche };
    disenoPedido.current = nuevo;
    disenosEnVuelo.current += 1;
    api.diseno(sid, nuevo)
      .catch(() => { disenoPedido.current = estado?.diseno ?? null; setAviso('No se pudo cambiar el diseño'); })
      .finally(() => { disenosEnVuelo.current -= 1; });
  };
  // La vista es PERSONAL (cada quien en su navegador): Moderación conduce la sesión, Producción cuida lo que se ve y se graba.
  const [vista, setVistaEstado] = useState<'moderacion' | 'produccion'>(() => {
    try { return localStorage.getItem('talks:vista') === 'produccion' ? 'produccion' : 'moderacion'; } catch { return 'moderacion'; }
  });
  const setVista = (v: 'moderacion' | 'produccion') => { setVistaEstado(v); try { localStorage.setItem('talks:vista', v); } catch { /* sin almacenamiento: no se recuerda */ } };
  const produccion = vista === 'produccion';
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

  // Quien está en el lobby sin conexión no se muestra (no se le puede llamar); reaparece si vuelve.
  const delLobby = participantes.filter((p) => p.lugar === 'lobby' && p.conectado);
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
          {!p.conectado && <><Velo /><SinConexion /></>}
          {!produccion && <ClicParaMover data-testid={`bajar-${p.nombre}`} texto="Clic para bajar a backstage" onClick={() => ejecutar('bajar', p.id)} />}
          {!produccion && <BotonMicrofono p={p} sid={sid} onError={setAviso} />}
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
          <div role="group" aria-label="Vista" className="inline-flex rounded-lg bg-gris-boton p-0.5">
            {([['moderacion', 'Moderación'], ['produccion', 'Producción']] as const).map(([v, nombre]) => (
              <button key={v} data-testid={`vista-${v}`} aria-pressed={vista === v} onClick={() => setVista(v)}
                className={`h-8 rounded-md px-3 text-[13px] font-semibold ${vista === v ? 'bg-teal text-white' : 'text-teal'}`}>{nombre}</button>
            ))}
          </div>
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
            <div className="mx-auto flex w-full flex-col gap-3" style={{ maxWidth: 'calc((100vh - 400px) * 16 / 9)', minWidth: 360 }} data-testid="columna-escenario">
              <Lienzo data-testid="lista-escenario" items={enEscena} diseno={estado.diseno} vacio="Nadie en el escenario" />
            <div className="flex flex-wrap items-center justify-center gap-2" data-testid="controles">
              <BotonControl data-testid="boton-mic" activo={micOn} encendido={{ icono: <Mic size={22} aria-hidden="true" />, texto: 'Silenciar mi micrófono' }} apagado={{ icono: <MicOff size={22} aria-hidden="true" />, texto: 'Activar mi micrófono' }} onClick={() => setMicOn(!micOn)} />
              <BotonControl data-testid="boton-cam" activo={camOn} encendido={{ icono: <IconoVideo size={22} aria-hidden="true" />, texto: 'Apagar mi cámara' }} apagado={{ icono: <VideoOff size={22} aria-hidden="true" />, texto: 'Encender mi cámara' }} onClick={() => setCamOn(!camOn)} />
              <SelectorDiseno diseno={estado.diseno} personas={enEscena.map((v) => ({ id: v.id, nombre: estado.equipo.find((m) => m.id === v.id)?.nombre ?? participantes.find((p) => p.id === v.id)?.nombre ?? '' }))}
                onElegir={elegirDiseno} />
              <Boton data-testid="mi-escenario" onClick={alternarEscenario}>
                <span className="inline-flex items-center gap-1.5"><ArrowRightLeft size={14} aria-hidden="true" />{enEscenario ? 'Ir a backstage' : 'Subirme al escenario'}</span>
              </Boton>
            </div>
          <Tarjeta className="shrink-0" data-testid="backstage" titulo="Backstage: solo lo ve el equipo" cuenta={enBackstage.length} icono={<EyeOff size={14} aria-hidden="true" />}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex flex-wrap items-start gap-3" data-testid="lista-backstage">
                {!enBackstage.length && <p className="text-[13px] text-tenue">Nadie en backstage</p>}
                {enBackstage.map((p) => (
                  <div key={p.id} className="flex w-52 flex-col gap-1.5" data-testid={`tarjeta-backstage-${p.nombre}`}>
                    <Mosaico nombre={p.nombre} pista={camaraDe(salaSesion, p.id)} className="aspect-video rounded-xl">
                      <Velo />
                      {!produccion && <ClicParaMover data-testid={`subir-${p.nombre}`} texto="Clic para subir al escenario" onClick={() => ejecutar('subir', p.id)} />}
                      {!produccion && <BotonMicrofono p={p} sid={sid} onError={setAviso} />}
                      {!p.conectado && <SinConexion />}
                    </Mosaico>
                    {!produccion && (
                      <div className="flex gap-1.5">
                        <Boton data-testid={`verde-${p.nombre}`} className="flex-1" onClick={() => ejecutar('llamar', p.id)} title="Regresar a la sala verde">Sala verde</Boton>
                        <Boton data-testid={`lobby-${p.nombre}`} className="flex-1" onClick={() => ejecutar('lobby', p.id)} title="Regresar al lobby">Lobby</Boton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {!enEscenario && miembro && (
                <div className="flex w-52 flex-col gap-1.5" data-testid="mi-vineta-backstage">
                  <Mosaico nombre={miembro.nombre} esYo flujo={vistaPrevia} pista={miCamara} espejo className="aspect-video rounded-xl">
                    <Velo />
                    <ClicParaMover data-testid="volver-escenario" texto="Clic para volver al escenario" onClick={alternarEscenario} />
                  </Mosaico>
                  <p className="text-[12px] text-tenue">Tú: haz clic en tu viñeta para volver al escenario.</p>
                </div>
              )}
            </div>
          </Tarjeta>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-3">
            {!produccion && (
              <>
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
              </>
            )}
            {produccion && (
              <Tarjeta titulo="Gente" data-testid="resumen-gente">
                <ul className="flex flex-col gap-2 text-[13px]">
                  <li className="flex flex-col gap-0.5"><span className="inline-flex items-center gap-1.5 font-semibold">{delLobby.length > 0 ? <Indicador tono="atencion" icono={BellRing}>{delLobby.length} en el lobby</Indicador> : <span className="text-tenue">Lobby: nadie</span>}</span>{delLobby.length > 0 && <span className="text-tenue">{delLobby.map((p) => p.nombre).join(', ')}</span>}</li>
                  <li className="flex flex-col gap-0.5"><span className="inline-flex items-center gap-1.5 font-semibold">{enVerde.length > 0 ? <Indicador tono="sala" icono={DoorOpen}>{enVerde.length} en la sala verde</Indicador> : <span className="text-tenue">Sala verde: nadie</span>}</span>{enVerde.length > 0 && <span className="text-tenue">{enVerde.map((p) => p.nombre).join(', ')}</span>}</li>
                  <li className="font-semibold">{enBackstage.length} en backstage, {enPantalla.length + estado.equipo.filter((m) => m.enEscenario).length} en el escenario</li>
                </ul>
                <p className="mt-2 text-[11px] text-tenue">A la gente la mueve quien modera. Desde Moderación puedes llamar, subir y bajar.</p>
              </Tarjeta>
            )}
            <ChatConsola key={vista} canalInicial={produccion ? 'equipo' : 'sesion'} sid={sid} mensajes={estado.mensajes} yo={yo} config={estado.chat} onError={setAviso}
              personasSesion={participantes.filter((p) => p.lugar === 'backstage' || p.lugar === 'escenario').map((p) => ({ id: p.id, nombre: p.nombre }))}
              personasVerde={enVerde.map((p) => ({ id: p.id, nombre: p.nombre }))} />
          </aside>
        </div>

      </main>

      {aviso && (
        <button onClick={limpiarAviso} className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-teal px-4 py-2 text-[13px] font-medium text-white shadow-lg" role="status" data-testid="aviso">{aviso}</button>
      )}
    </div>
  );
}
