import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ConnectionState, Room, RoomEvent, Track, VideoPresets, type RemoteAudioTrack } from 'livekit-client';
import { Mic, MicOff, Video as IconoVideo, VideoOff } from 'lucide-react';
import type { EstadoParticipante, Lugar, RespuestaEntrar } from '../../compartido/tipos';
import { api, ErrorApi } from '../lib/api';
import { useCanal } from '../lib/canal';
import { camaraDe, esperarPermisoDePublicar, permitidosDeParticipante, proteger, useCambiosDeSala } from '../lib/sala';
import { listarDispositivos, pedirPermiso, useNivelMicrofono, useVistaPrevia, type Dispositivos, type PermisoMedios } from '../lib/medios';
import { Mosaico } from '../components/Mosaico';
import { AudioRemoto } from '../components/Video';
import { Lienzo } from '../components/Lienzo';
import { AVISO_ACEPTO, AVISO_COMPLETO, AVISO_RESUMEN } from '../lib/aviso';

type Paso = 'cargando' | 'invalido' | 'aviso' | 'nombre' | 'dispositivos' | 'dentro';
interface Guardado { entrada: RespuestaEntrar; camId?: string; micId?: string }

const clave = (codigo: string) => `estudio:${codigo}`;
function leerGuardado(codigo: string): Guardado | null {
  try { return JSON.parse(sessionStorage.getItem(clave(codigo)) ?? 'null') as Guardado | null; } catch { return null; }
}

function Marco({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-5 py-6">{children}</div>;
}
function Tarjeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-borde bg-tarjeta p-4 ${className ?? ''}`}>{children}</div>;
}
const BotonPrincipal = (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={`h-12 rounded-xl bg-teal px-5 text-[15px] font-semibold text-white ${p.className ?? ''}`} />
);

export default function Participante() {
  const { codigo = '' } = useParams();
  const guardado = useMemo(() => leerGuardado(codigo), [codigo]);
  const [paso, setPaso] = useState<Paso>(guardado ? 'dentro' : 'cargando');
  const [sesion, setSesion] = useState<{ nombre: string } | null>(null);
  const [nombre, setNombre] = useState('');
  const [camId, setCamId] = useState<string | undefined>(guardado?.camId);
  const [micId, setMicId] = useState<string | undefined>(guardado?.micId);
  const [entrada, setEntrada] = useState<RespuestaEntrar | null>(guardado?.entrada ?? null);
  const [errorEntrada, setErrorEntrada] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [acepto, setAcepto] = useState(false);

  useEffect(() => {
    if (paso !== 'cargando') return;
    api.infoLink(codigo).then((s) => { setSesion(s); setPaso('aviso'); }).catch(() => setPaso('invalido'));
  }, [codigo, paso]);

  async function entrar() {
    setEntrando(true); setErrorEntrada(null);
    try {
      const e = await api.entrar(codigo, nombre.trim());
      sessionStorage.setItem(clave(codigo), JSON.stringify({ entrada: e, camId, micId } satisfies Guardado));
      setEntrada(e); setPaso('dentro');
    } catch (err) {
      setErrorEntrada(err instanceof ErrorApi ? err.message : 'No pudimos conectarte. Intenta de nuevo.');
    } finally { setEntrando(false); }
  }

  if (paso === 'cargando') return <Marco><p className="text-sm text-tenue">Cargando…</p></Marco>;
  if (paso === 'invalido') return <Marco><Tarjeta><h1 className="text-lg font-semibold">Este link no es válido</h1><p className="mt-1 text-sm text-tenue">Pide uno nuevo a quien te invitó.</p></Tarjeta></Marco>;

  if (paso === 'aviso') {
    return (
      <Marco>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold" data-testid="titulo-sesion">{sesion?.nombre}</h1>
          <p className="text-[15px] font-semibold">Antes de entrar</p>
          <p className="text-[13px] leading-5 text-tenue">{AVISO_RESUMEN}</p>
        </div>
        <Tarjeta className="flex flex-col gap-2" >
          <h2 className="text-[13px] font-semibold">Aviso de privacidad</h2>
          {AVISO_COMPLETO.map((t) => <p key={t} className="text-[13px] leading-5 text-tenue">{t}</p>)}
        </Tarjeta>
        <label className="flex items-start gap-3 text-[14px] leading-5">
          <input type="checkbox" data-testid="acepto-aviso" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#0f3d4d]" />
          <span>{AVISO_ACEPTO}</span>
        </label>
        <BotonPrincipal data-testid="aceptar-aviso" disabled={!acepto} onClick={() => setPaso('nombre')}>Continuar</BotonPrincipal>
      </Marco>
    );
  }

  if (paso === 'nombre') {
    return (
      <Marco>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold" data-testid="titulo-sesion">{sesion?.nombre}</h1>
          <p className="text-[13px] leading-5 text-tenue">Escribe tu nombre como quieres que te vean.</p>
        </div>
        <Tarjeta className="flex flex-col gap-3">
          <label className="text-[13px] font-medium" htmlFor="nombre">Tu nombre</label>
          <input id="nombre" data-testid="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60}
            className="h-12 rounded-xl border border-borde-fuerte px-3 text-[15px]" autoComplete="given-name"
            onKeyDown={(e) => { if (e.key === 'Enter' && nombre.trim()) setPaso('dispositivos'); }} />
        </Tarjeta>
        <BotonPrincipal data-testid="continuar" disabled={!nombre.trim()} onClick={() => setPaso('dispositivos')}>Continuar</BotonPrincipal>
      </Marco>
    );
  }

  if (paso === 'dispositivos') {
    return (
      <PruebaDeDispositivos nombre={nombre} camId={camId} micId={micId} setCamId={setCamId} setMicId={setMicId}
        entrando={entrando} error={errorEntrada} onVolver={() => setPaso('nombre')} onListo={entrar} />
    );
  }

  return <Dentro entrada={entrada!} camId={camId} micId={micId} />;
}

// ───────────────────────── Probar dispositivos ─────────────────────────
function PruebaDeDispositivos({ nombre, camId, micId, setCamId, setMicId, entrando, error, onVolver, onListo }: {
  nombre: string; camId?: string; micId?: string; setCamId: (v: string) => void; setMicId: (v: string) => void;
  entrando: boolean; error: string | null; onVolver: () => void; onListo: () => void;
}) {
  const [permiso, setPermiso] = useState<PermisoMedios>('pendiente');
  const [disp, setDisp] = useState<Dispositivos>({ camaras: [], microfonos: [] });

  async function pedir() {
    setPermiso('pendiente');
    const r = await pedirPermiso();
    setPermiso(r);
    if (r === 'concedido') {
      const lista = await listarDispositivos();
      setDisp(lista);
      if (!camId && lista.camaras[0]) setCamId(lista.camaras[0].deviceId);
      if (!micId && lista.microfonos[0]) setMicId(lista.microfonos[0].deviceId);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void pedir(); }, []);

  const lista = permiso === 'concedido';
  const flujo = useVistaPrevia(camId, lista);
  const nivel = useNivelMicrofono(micId, lista);

  return (
    <Marco>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Hola, {nombre.trim()}</h1>
        <p className="text-[13px] leading-5 text-tenue">Revisa que te veas y te escuchen bien.</p>
      </div>

      {(permiso === 'negado' || permiso === 'sin-dispositivo') ? (
        <Tarjeta className="flex flex-col gap-3">
          <p className="text-[13px] leading-5" data-testid="sin-permiso">
            {permiso === 'negado'
              ? 'Necesitamos tu cámara y micrófono. Permítelos en la barra de direcciones del navegador y vuelve a intentar.'
              : 'No encontramos una cámara o un micrófono. Conéctalos y vuelve a intentar.'}
          </p>
          <button onClick={() => void pedir()} className="h-11 rounded-xl bg-gris-boton text-sm font-semibold text-teal">Volver a intentar</button>
        </Tarjeta>
      ) : (
        <>
          <Mosaico nombre={nombre} esYo flujo={flujo} espejo className="aspect-video w-full rounded-2xl" />
          <Tarjeta className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">Cámara
              <select value={camId} onChange={(e) => setCamId(e.target.value)} className="h-11 rounded-xl border border-borde-fuerte bg-white px-2 text-sm font-normal">
                {disp.camaras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Micrófono
              <select value={micId} onChange={(e) => setMicId(e.target.value)} className="h-11 rounded-xl border border-borde-fuerte bg-white px-2 text-sm font-normal">
                {disp.microfonos.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micrófono ${i + 1}`}</option>)}
              </select>
            </label>
            <div className="h-2 overflow-hidden rounded-full bg-gris-boton" aria-label="Nivel del micrófono">
              <div className="h-full rounded-full bg-ok transition-[width] duration-75" style={{ width: `${Math.round(nivel * 100)}%` }} data-testid="nivel-mic" />
            </div>
          </Tarjeta>
        </>
      )}

      {error && <p className="text-[13px] text-peligro" role="alert">{error}</p>}
      <div className="mt-auto flex gap-3">
        <button onClick={onVolver} className="h-12 rounded-xl bg-gris-boton px-5 text-[15px] font-semibold text-teal">Atrás</button>
        <BotonPrincipal data-testid="todo-listo" className="flex-1" disabled={!lista || entrando || !camId || !micId} onClick={onListo}>
          {entrando ? 'Entrando…' : 'Todo listo'}
        </BotonPrincipal>
      </div>
    </Marco>
  );
}

// ───────────────────────── Ya dentro: lobby, sala verde, backstage y escenario ─────────────────────────
const etiquetaLugar: Record<Lugar, string> = { lobby: 'En el lobby', verde: 'Con el equipo', backstage: 'En espera', escenario: 'En pantalla' };

function Dentro({ entrada, camId, micId }: { entrada: RespuestaEntrar; camId?: string; micId?: string }) {
  const { estado, conectado } = useCanal<EstadoParticipante>({ rol: 'participante', sid: entrada.sesionId, pase: entrada.pase });
  const [room, setRoom] = useState<Room | null>(null);
  useCambiosDeSala(room);

  // Conexión con LiveKit: una sola sala por sesión, siempre con un pase nuevo con los permisos del lugar donde estoy (sirve también tras recargar).
  useEffect(() => {
    let cancelado = false;
    const r = new Room({
      adaptiveStream: false, dynacast: false,
      videoCaptureDefaults: { deviceId: camId, resolution: VideoPresets.h360.resolution },
      audioCaptureDefaults: { deviceId: micId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const conectar = async () => {
      for (let intento = 0; !cancelado; intento++) {
        try {
          const lk = await api.livekitActual(entrada.pase);
          if (cancelado) return;
          await r.connect(lk.url, lk.token, { autoSubscribe: true });
          return;
        } catch (e) {
          if (cancelado || (e instanceof ErrorApi && (e.estado === 410 || e.estado === 404))) return;
          await new Promise((res) => setTimeout(res, Math.min(400 * 2 ** intento, 5000)));
        }
      }
    };
    r.on(RoomEvent.Disconnected, () => { if (!cancelado) void conectar(); });
    if (window.__TRAZA) (window as unknown as { __sala?: Room }).__sala = r;
    setRoom(r);
    void conectar();
    return () => { cancelado = true; void r.disconnect(); };
  }, [entrada.pase, camId, micId]);

  const lugar: Lugar | undefined = estado?.yo.lugar;
  const equipoIds = useMemo(() => (estado?.equipo ?? []).map((m) => m.id).sort().join(','), [estado?.equipo]);
  const verdeCon = estado?.yo.verdeCon ?? null;
  const conectadoLK = room?.state === ConnectionState.Connected;
  // Si el equipo le quitó el micrófono, no se enciende solo al cambiar de lugar y el botón queda apagado. Al permitirlo, NO se enciende solo: decide la persona.
  const silenciado = !!estado?.yo.silenciado;
  const silenciadoRef = useRef(false);
  silenciadoRef.current = silenciado;
  // Lo que la persona decide con sus botones manda SIEMPRE: cambiar de lugar o de equipo no le vuelve a encender nada.
  const [quiereMic, setQuiereMic] = useState(true);
  const [quiereCam, setQuiereCam] = useState(true);
  const quiere = useRef({ mic: true, cam: true });
  quiere.current = { mic: quiereMic, cam: quiereCam };
  useEffect(() => {
    if (room && conectadoLK && silenciado) void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
  }, [room, conectadoLK, silenciado]);

  // La pantalla sigue SIEMPRE al estado del servidor: según el lugar se enciende o se apaga lo que publico y quién puede recibirlo.
  useEffect(() => {
    if (!room || !lugar || !conectadoLK) return;
    let cancelado = false;
    void (async () => {
      if (lugar === 'lobby') {
        await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        return;
      }
      proteger(room, permitidosDeParticipante(lugar, equipoIds ? equipoIds.split(',') : [], verdeCon));
      if (!(await esperarPermisoDePublicar(room)) || cancelado) return;
      await room.localParticipant.setMicrophoneEnabled(quiere.current.mic && !silenciadoRef.current).catch(() => undefined);
      await room.localParticipant.setCameraEnabled(quiere.current.cam).catch(() => undefined);
    })();
    return () => { cancelado = true; };
  }, [room, lugar, equipoIds, verdeCon, conectadoLK]);

  const pubCamara = room?.localParticipant.getTrackPublication(Track.Source.Camera);
  const camaraLocal = pubCamara && !pubCamara.isMuted ? pubCamara.track ?? null : null;
  const micEncendido = !!room?.localParticipant.isMicrophoneEnabled;
  const camEncendida = !!room?.localParticipant.isCameraEnabled;
  const vistaPrevia = useVistaPrevia(camId, lugar === 'lobby' || (quiereCam && !camaraLocal));
  const nivel = useNivelMicrofono(micId, lugar === 'lobby');

  if (!estado) return <Marco><p className="text-sm text-tenue">Conectando…</p></Marco>;
  if (estado.sesion.terminada) return <Marco><Tarjeta><h1 className="text-lg font-semibold">La sesión terminó</h1><p className="mt-1 text-sm text-tenue">Gracias por participar.</p></Tarjeta></Marco>;

  const yo = estado.yo;
  const equipoEnEscenario = estado.equipo.filter((m) => m.enEscenario);
  const enPantalla = [...equipoEnEscenario.map((m) => ({ id: m.id, nombre: m.nombre })), ...estado.escenario];
  const otrosEnPantalla = enPantalla.filter((p) => p.id !== yo.id);
  const conQuien = estado.equipo.find((m) => m.id === yo.verdeCon);
  const sonidos = room ? [...room.remoteParticipants.values()].map((p) => p.getTrackPublication(Track.Source.Microphone)?.track).filter(Boolean) as RemoteAudioTrack[] : [];

  const chip = (
    <span data-testid="chip-lugar" className={`rounded-md px-2.5 py-1 text-xs font-semibold ${lugar === 'escenario' ? 'bg-teal text-white' : 'bg-teal-claro text-teal'}`}>{etiquetaLugar[yo.lugar]}</span>
  );
  const punto = (
    <span title={conectado && conectadoLK ? 'Conexión buena' : 'Reconectando…'} className={`inline-block h-2.5 w-2.5 rounded-full ${conectado && conectadoLK ? 'bg-ok' : 'bg-aviso'}`} />
  );

  return (
    <div data-lugar={yo.lugar} data-testid="dentro" className={`mx-auto flex min-h-full w-full flex-col ${yo.lugar === 'backstage' || yo.lugar === 'escenario' ? 'max-w-md md:max-w-5xl' : 'max-w-md'}`}>
      <div className="flex items-center justify-between px-5 pb-3 pt-5">{chip}{punto}</div>
      {sonidos.map((t) => <AudioRemoto key={t.sid} pista={t} />)}
      {room && !room.canPlaybackAudio && (
        <button onClick={() => void room.startAudio()} className="mx-5 mb-3 h-11 rounded-xl bg-oro text-sm font-semibold text-oro-texto">Activar el sonido</button>
      )}

      {yo.lugar === 'lobby' && (
        <div className="flex flex-col gap-4 px-5 pb-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Estás en la sala de espera</h1>
            <p className="text-[13px] leading-5 text-tenue">El equipo te va a llamar en un momento.</p>
          </div>
          <Mosaico nombre={yo.nombre} esYo flujo={vistaPrevia} espejo className="aspect-video w-full rounded-2xl" />
          <div className="h-2 overflow-hidden rounded-full bg-gris-boton"><div className="h-full rounded-full bg-ok transition-[width] duration-75" style={{ width: `${Math.round(nivel * 100)}%` }} /></div>
        </div>
      )}

      {yo.lugar === 'verde' && (
        <div className="flex flex-col gap-4 px-5 pb-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Estás hablando con {conQuien?.nombre ?? 'el equipo'}</h1>
            <p className="text-[13px] leading-5 text-tenue">Es una revisión rápida de tu cámara y tu sonido.</p>
          </div>
          <div className="relative">
            <Mosaico nombre={conQuien?.nombre ?? 'Equipo'} pista={camaraDe(room, yo.verdeCon ?? '')} className="aspect-video w-full rounded-2xl" />
            <Mosaico nombre={yo.nombre} esYo pista={camaraLocal} flujo={camaraLocal ? null : vistaPrevia} espejo className="absolute bottom-3 right-3 aspect-video w-28 rounded-xl border-2 border-white" />
          </div>
        </div>
      )}

      {(yo.lugar === 'backstage' || yo.lugar === 'escenario') && (
        <div className="flex flex-col gap-4 pb-6">
          <div className="px-3 md:px-5">
            <Lienzo data-testid="escenario" vacio="Todavía no hay nadie en pantalla" diseno={estado.diseno}
              items={enPantalla.map((p) => ({
                id: p.id,
                nodo: p.id === yo.id
                  ? <Mosaico nombre={yo.nombre} esYo pista={camaraLocal} flujo={camaraLocal ? null : vistaPrevia} espejo className="h-full w-full" />
                  : <Mosaico nombre={p.nombre} pista={camaraDe(room, p.id)} className="h-full w-full" />,
              }))} />
          </div>
          <div className="flex flex-col gap-1 px-5">
            <h1 className="text-lg font-semibold">{yo.lugar === 'escenario' ? 'Estás en pantalla' : 'Estás en espera'}</h1>
            <p className="text-[13px] leading-5 text-tenue">{yo.lugar === 'escenario' ? 'Te ven y te escuchan.' : 'Escuchas la sesión. Todavía no te ven ni te oyen.'}</p>
            {silenciado && <p data-testid="aviso-silenciado" className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-peligro-fondo px-2.5 py-1.5 text-[13px] font-medium text-peligro"><MicOff size={14} aria-hidden="true" />El equipo silenció tu micrófono. Te avisarán cuando puedas hablar.</p>}
          </div>
          {yo.lugar === 'backstage' && (
            <div className="flex items-center gap-3 px-5">
              <Mosaico nombre={yo.nombre} esYo pista={camaraLocal} flujo={camaraLocal ? null : vistaPrevia} espejo className="aspect-[4/3] w-32 rounded-xl opacity-60" />
              <span className="text-[13px] leading-5 text-tenue">Solo tú te ves aquí</span>
            </div>
          )}
        </div>
      )}

      {yo.lugar !== 'lobby' && (
        <div className="mx-5 mb-5 mt-auto flex justify-center gap-6 rounded-3xl border border-borde bg-tarjeta px-4 py-3">
          <button aria-label={silenciado ? 'El equipo silenció tu micrófono' : micEncendido ? 'Silenciar micrófono' : 'Activar micrófono'} title={silenciado ? 'El equipo silenció tu micrófono' : undefined} data-testid="boton-mic" disabled={silenciado}
            onClick={() => { const nuevo = !micEncendido; setQuiereMic(nuevo); void room?.localParticipant.setMicrophoneEnabled(nuevo); }}
            className={`flex h-[56px] w-[56px] items-center justify-center rounded-full text-white ${micEncendido ? 'bg-teal' : 'bg-peligro'}`}>
            {micEncendido ? <Mic size={24} aria-hidden="true" /> : <MicOff size={24} aria-hidden="true" />}
          </button>
          <button aria-label={camEncendida ? 'Apagar cámara' : 'Encender cámara'} data-testid="boton-cam"
            onClick={() => { const nuevo = !camEncendida; setQuiereCam(nuevo); void room?.localParticipant.setCameraEnabled(nuevo); }}
            className={`flex h-[56px] w-[56px] items-center justify-center rounded-full text-white ${camEncendida ? 'bg-teal' : 'bg-peligro'}`}>
            {camEncendida ? <IconoVideo size={24} aria-hidden="true" /> : <VideoOff size={24} aria-hidden="true" />}
          </button>
        </div>
      )}
    </div>
  );
}
