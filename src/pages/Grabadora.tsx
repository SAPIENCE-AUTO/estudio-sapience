import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Room, Track, type RemoteAudioTrack } from 'livekit-client';
import type { EstadoGrabadora } from '../../compartido/tipos';
import { useCanal } from '../lib/canal';
import { camaraDe, useCambiosDeSala } from '../lib/sala';
import { Lienzo } from '../components/Lienzo';
import { Mosaico } from '../components/Mosaico';
import { AudioRemoto } from '../components/Video';

/**
 * La página que se TRANSMITE: LiveKit la abre en un navegador sin pantalla y manda lo que dibuja (video y sonido) a Mux.
 * No tiene botones ni textos de la app: solo el escenario con el diseño elegido, a pantalla completa.
 * PRIVACIDAD: dibuja y escucha ÚNICAMENTE a quienes el servidor dice que están en el escenario. Aunque su pase de LiveKit podría recibir
 * también el backstage y la sala verde, esas pistas no se muestran ni se reproducen aquí.
 */
export default function Grabadora() {
  const { sid = '' } = useParams();
  const boleto = useMemo(() => new URLSearchParams(location.search).get('t') ?? '', []);
  const { estado } = useCanal<EstadoGrabadora>(boleto ? { rol: 'grabadora', sid, boleto } : null);
  const [room, setRoom] = useState<Room | null>(null);
  useCambiosDeSala(room);
  const avisado = useRef(false);

  useEffect(() => {
    if (!boleto) return;
    let cancelado = false;
    const r = new Room({ adaptiveStream: false, dynacast: false });
    void (async () => {
      for (let intento = 0; !cancelado; intento++) {
        try {
          const res = await fetch('/api/grabadora/livekit', { method: 'POST', headers: { authorization: `Bearer ${boleto}` } });
          if (res.status >= 400 && res.status < 500) return; // boleto vencido o sesión terminada: no tiene caso reintentar
          if (!res.ok) throw new Error('sin pase');
          const lk = await res.json() as { url: string; token: string };
          if (cancelado) return;
          await r.connect(lk.url, lk.token, { autoSubscribe: true });
          if (window.__TRAZA) (window as unknown as { __sala?: Room }).__sala = r;
          setRoom(r);
          return;
        } catch { await new Promise((ok) => setTimeout(ok, Math.min(500 * 2 ** intento, 5000))); }
      }
    })();
    r.on('disconnected', () => { if (!cancelado) setRoom(null); });
    return () => { cancelado = true; void r.disconnect(); };
  }, [boleto]);

  // LiveKit espera esta señal para empezar a transmitir: ya hay conexión y ya se sabe quién está en el escenario.
  const lista = room?.state === 'connected' && !!estado;
  useEffect(() => {
    if (!lista || avisado.current) return;
    avisado.current = true;
    const t = setTimeout(() => console.log('START_RECORDING'), 1500); // un momento para que lleguen los primeros cuadros
    return () => clearTimeout(t);
  }, [lista]);

  if (!boleto) return <div className="p-6 text-sm text-tenue">Falta el boleto de la transmisión.</div>;

  const escena = estado?.escena ?? [];
  const sonidos = escena
    .map((p) => room?.remoteParticipants.get(p.id)?.getTrackPublication(Track.Source.Microphone)?.track)
    .filter(Boolean) as RemoteAudioTrack[];

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black" data-testid="grabadora">
      <div style={{ width: 'min(100vw, calc(100vh * 16 / 9))' }}>
        <Lienzo data-testid="escena-grabadora" className="rounded-none!" diseno={estado?.diseno ?? { tipo: 'auto', fijado: null, forma: 'redondeada', ajuste: 'llenar', fondo: 'gris' }}
          items={escena.map((p) => ({ id: p.id, nodo: <Mosaico nombre={p.nombre} pista={camaraDe(room, p.id)} className="h-full w-full" /> }))} />
      </div>
      {sonidos.map((t) => <AudioRemoto key={t.sid} pista={t} />)}
    </div>
  );
}
