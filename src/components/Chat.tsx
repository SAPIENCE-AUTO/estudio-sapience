import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, MessageCircle, Send } from 'lucide-react';
import { MAX_TEXTO_CHAT, type CanalChat, type ConfigChat, type MensajePublico } from '../../compartido/tipos';
import { api } from '../lib/api';

/** Cuántos mensajes de otros llegaron después de la última vez que se miró ese chat. */
const sinLeer = (mensajes: MensajePublico[], yo: string, visto: number) => mensajes.filter((m) => m.en > visto && m.deId !== yo).length;

function Nuevos({ cuantos }: { cuantos: number }) {
  if (cuantos <= 0) return null;
  return (
    <span data-testid="chat-nuevos" className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-atencion px-2 py-0.5 text-[11px] font-semibold text-white">
      <MessageCircle size={11} aria-hidden="true" />{cuantos === 1 ? '1 nuevo' : `${cuantos} nuevos`}
    </span>
  );
}

function Escribir({ onEnviar, deshabilitado, ...resto }: { onEnviar: (texto: string) => Promise<void> | void; deshabilitado?: boolean; 'data-testid'?: string }) {
  const [texto, setTexto] = useState('');
  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio) return;
    setTexto('');
    await onEnviar(limpio);
  };
  return (
    <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <input data-testid={resto['data-testid'] ?? 'chat-texto'} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={MAX_TEXTO_CHAT} disabled={deshabilitado} placeholder="Escribe un mensaje"
        className="h-10 min-w-0 flex-1 rounded-xl border border-borde-fuerte bg-white px-3 text-[13px]" />
      <button type="submit" data-testid="chat-enviar" aria-label="Enviar" disabled={deshabilitado || !texto.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal text-white"><Send size={16} aria-hidden="true" /></button>
    </form>
  );
}

/** Interruptor con texto: azul oscuro encendido, gris apagado. El texto dice el estado, así que no depende solo del color. */
function Interruptor({ activo, onCambiar, etiqueta, estado, ...resto }: { activo: boolean; onCambiar: (nuevo: boolean) => void; etiqueta: string; estado: string; 'data-testid'?: string }) {
  return (
    <button {...resto} type="button" role="switch" aria-checked={activo} onClick={() => onCambiar(!activo)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-borde px-3 py-2 text-left">
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold">{etiqueta}</span>
        <span className="block text-[11px] leading-tight text-tenue">{estado}</span>
      </span>
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${activo ? 'bg-teal' : 'bg-borde-fuerte'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${activo ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

const hora = (en: number) => new Date(en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

/** Chat de la consola: tres pestañas, una por lugar. Sesión (con los participantes de adentro), Sala verde (con quien estás revisando) y Equipo (interno). */
export function ChatConsola({ sid, mensajes, yo, personasSesion, personasVerde, config, onError }: {
  sid: string;
  mensajes: MensajePublico[];
  /** Id del miembro del equipo que está viendo la consola. */
  yo: string;
  /** Participantes a quienes se les puede escribir en privado en el chat de la sesión (ya están en backstage o en el escenario). */
  personasSesion: { id: string; nombre: string }[];
  /** Participantes que están ahora en la sala verde. */
  personasVerde: { id: string; nombre: string }[];
  config: ConfigChat;
  onError: (m: string) => void;
}) {
  const [canal, setCanal] = useState<CanalChat>('sesion');
  const [visto, setVisto] = useState<Record<CanalChat, number>>({ sesion: 0, verde: 0, equipo: 0 });
  const [paraSesion, setParaSesion] = useState('todos');
  const [paraVerde, setParaVerde] = useState('');
  const lista = useRef<HTMLDivElement>(null);
  const delCanal = useMemo(() => ({
    sesion: mensajes.filter((m) => m.canal === 'sesion'), verde: mensajes.filter((m) => m.canal === 'verde'), equipo: mensajes.filter((m) => m.canal === 'equipo'),
  }), [mensajes]);
  const actuales = delCanal[canal];
  const ultimo = actuales[actuales.length - 1]?.en ?? 0;
  const personas = canal === 'verde' ? personasVerde : personasSesion;
  const nombreDe = (id: string) => [...personasSesion, ...personasVerde].find((p) => p.id === id)?.nombre ?? 'una persona';

  // Mirar un chat lo deja «leído» y baja al último mensaje.
  useEffect(() => {
    setVisto((v) => (v[canal] >= ultimo ? v : { ...v, [canal]: ultimo }));
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [canal, ultimo, actuales.length]);

  // Si la persona a quien se le escribía ya no está, se vuelve a «todos» (sesión) o a la primera de la sala verde.
  useEffect(() => { if (paraSesion !== 'todos' && !personasSesion.some((p) => p.id === paraSesion)) setParaSesion('todos'); }, [personasSesion, paraSesion]);
  useEffect(() => { if (!personasVerde.some((p) => p.id === paraVerde)) setParaVerde(personasVerde[0]?.id ?? ''); }, [personasVerde, paraVerde]);

  const para = canal === 'sesion' ? paraSesion : canal === 'verde' ? paraVerde : 'equipo';
  const enviar = async (texto: string) => {
    try { await api.chatEquipo(sid, canal, texto, para); }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo enviar'); }
  };
  const cambiarConfig = (parche: Partial<ConfigChat>) => void api.chatConfig(sid, { ...config, ...parche }).catch(() => onError('No se pudo cambiar el chat'));
  const pestana = (c: CanalChat, nombre: string) => (
    <button data-testid={`chat-tab-${c}`} onClick={() => setCanal(c)} aria-pressed={canal === c}
      className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 text-[12px] font-semibold ${canal === c ? 'bg-teal text-white' : 'bg-gris-boton text-teal'}`}>
      {nombre}{canal !== c && <Nuevos cuantos={sinLeer(delCanal[c], yo, visto[c])} />}
    </button>
  );
  const opcion = (activa: boolean) => `flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold ${activa ? 'border-teal bg-teal-claro text-teal' : 'border-borde text-texto'}`;
  const ayuda = {
    sesion: config.abierto
      ? (config.grupal ? 'Los participantes de adentro se leen entre sí y te leen a ti.' : 'Los participantes no se leen entre sí: cada uno solo lee lo suyo y lo que tú le contestas.')
      : 'El chat está cerrado: los participantes no ven el chat ni pueden escribir.',
    verde: 'Solo la persona que está en la sala verde y el equipo.',
    equipo: 'Solo el equipo ve este chat. Los participantes nunca.',
  }[canal];

  return (
    <section className="flex h-[36rem] flex-col rounded-2xl border border-borde bg-tarjeta p-3" data-testid="chat-consola">
      <div className="mb-2 flex gap-1.5">{pestana('sesion', 'Sesión')}{pestana('verde', 'Sala verde')}{pestana('equipo', 'Equipo')}</div>
      {canal === 'sesion' && (
        <div className="mb-2 flex flex-col gap-1.5" data-testid="chat-config">
          <Interruptor data-testid="chat-interruptor-abierto" activo={config.abierto} etiqueta="Chat de la sesión"
            estado={config.abierto ? 'Abierto: los participantes pueden escribir' : 'Cerrado: no pueden escribir'} onCambiar={(abierto) => cambiarConfig({ abierto })} />
          <Interruptor data-testid="chat-interruptor-grupal" activo={config.grupal} etiqueta="Los participantes se leen entre sí"
            estado={config.grupal ? 'Sí: es un chat de grupo' : 'No: cada quien habla solo con el equipo'} onCambiar={(grupal) => cambiarConfig({ grupal })} />
        </div>
      )}
      <p className="mb-1.5 text-[11px] text-tenue">{ayuda}</p>
      <div ref={lista} data-testid="chat-mensajes" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl bg-fondo p-2">
        {actuales.length === 0 && <p className="m-auto text-[12px] text-tenue">Todavía no hay mensajes.</p>}
        {actuales.map((m) => {
          const mio = m.deId === yo;
          const destino = canal === 'equipo' || m.deRol === 'participante' ? '' : m.para === 'todos' ? 'a todos' : `a ${nombreDe(m.para)}`;
          return (
            <div key={m.id} data-testid="chat-mensaje" className={`max-w-[92%] rounded-xl px-2.5 py-1.5 text-[13px] leading-snug ${mio ? 'self-end bg-teal text-white' : 'self-start bg-white text-texto'}`}>
              <div className={`text-[11px] font-semibold ${mio ? 'text-white/80' : 'text-tenue'}`}>{mio ? 'Tú' : m.deNombre}{destino ? ` (${destino})` : ''} {hora(m.en)}</div>
              <div className="break-words">{m.texto}</div>
              {canal !== 'equipo' && m.deRol === 'participante' && personas.some((p) => p.id === m.deId) && (
                <button data-testid={`chat-responder-${m.deNombre}`} onClick={() => (canal === 'sesion' ? setParaSesion(m.deId) : setParaVerde(m.deId))} className="mt-0.5 text-[11px] font-semibold text-teal underline underline-offset-2">Responder a {m.deNombre}</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {canal === 'sesion' && (
          <label className="flex items-center gap-2 text-[12px] font-semibold">Para
            <select data-testid="chat-para" value={paraSesion} onChange={(e) => setParaSesion(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-borde-fuerte bg-white px-2 text-[13px] font-normal">
              <option value="todos">Todos los participantes</option>
              {personasSesion.map((p) => <option key={p.id} value={p.id}>Solo {p.nombre}</option>)}
            </select>
          </label>
        )}
        {canal === 'verde' && (
          personasVerde.length === 0
            ? <p className="text-[12px] text-tenue">Nadie en la sala verde.</p>
            : (
              <label className="flex items-center gap-2 text-[12px] font-semibold">Para
                <select data-testid="chat-para-verde" value={paraVerde} onChange={(e) => setParaVerde(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-borde-fuerte bg-white px-2 text-[13px] font-normal">
                  {personasVerde.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
            )
        )}
        <Escribir onEnviar={enviar} deshabilitado={canal === 'verde' && personasVerde.length === 0} />
      </div>
    </section>
  );
}

/** Chat del participante: una fila colapsada con el aviso de mensajes nuevos; al abrirla escribe al equipo y lee lo que le contestan. */
export function ChatParticipante({ pase, mensajes, yo, titulo, nota, cerrado }: {
  pase: string; mensajes: MensajePublico[]; yo: string;
  titulo: string;
  /** Aviso corto arriba de los mensajes (por ejemplo, quién los puede leer). */
  nota?: string;
  /** El equipo cerró el chat: se ve la fila con un candado y no se puede abrir. */
  cerrado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [visto, setVisto] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const ultimo = mensajes[mensajes.length - 1]?.en ?? 0;
  useEffect(() => {
    if (!abierto) return;
    setVisto((v) => Math.max(v, ultimo));
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [abierto, ultimo, mensajes.length]);
  const nuevos = abierto ? 0 : sinLeer(mensajes, yo, visto);
  const enviar = async (texto: string) => {
    setError(null);
    try { await api.chatParticipante(pase, texto); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar'); }
  };
  if (cerrado) {
    return (
      <section className="mx-5 flex h-12 items-center gap-2 rounded-2xl border border-borde bg-tarjeta px-4 text-[14px] font-semibold text-tenue" data-testid="chat-cerrado-aviso">
        <Lock size={18} aria-hidden="true" />El equipo cerró el chat
      </section>
    );
  }
  return (
    <section className="mx-5 rounded-2xl border border-borde bg-tarjeta" data-testid="chat-participante">
      <button data-testid="chat-barra" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="flex h-12 w-full items-center justify-between gap-2 px-4 text-[14px] font-semibold">
        <span className="inline-flex items-center gap-2"><MessageCircle size={18} aria-hidden="true" />{titulo}</span>
        <span className="inline-flex items-center gap-2"><Nuevos cuantos={nuevos} />{abierto ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}</span>
      </button>
      {abierto && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {nota && <p className="text-[12px] text-tenue">{nota}</p>}
          <div ref={lista} data-testid="chat-mensajes" className="flex max-h-[40vh] min-h-24 flex-col gap-1.5 overflow-y-auto rounded-xl bg-fondo p-2">
            {mensajes.length === 0 && <p className="m-auto text-[12px] text-tenue">Escribe aquí si necesitas algo del equipo.</p>}
            {mensajes.map((m) => {
              const mio = m.deId === yo;
              return (
                <div key={m.id} data-testid="chat-mensaje" className={`max-w-[88%] rounded-xl px-2.5 py-1.5 text-[14px] leading-snug ${mio ? 'self-end bg-teal text-white' : 'self-start bg-white text-texto'}`}>
                  {!mio && <div className="text-[11px] font-semibold text-tenue">{m.deNombre}{m.para === 'tu' ? ' (solo para ti)' : ''}</div>}
                  <div className="break-words">{m.texto}</div>
                </div>
              );
            })}
          </div>
          {error && <p role="alert" className="text-[12px] text-peligro">{error}</p>}
          <Escribir onEnviar={enviar} />
        </div>
      )}
    </section>
  );
}
