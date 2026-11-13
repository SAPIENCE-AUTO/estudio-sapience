// Canal en vivo con el servidor. Solo acepta estados con una versión MAYOR a la ya vista: nada viejo o repetido
// puede hacer parpadear la pantalla. Si se cae, reintenta solo y al volver acepta la primera vista que llegue.
import { useEffect, useRef, useState } from 'react';
import type { Estado } from '../../compartido/tipos';
import { api } from './api';
import { traza } from './traza';

export type Destino =
  | { rol: 'participante'; sid: string; pase: string }
  | { rol: 'equipo'; sid: string }
  | { rol: 'grabadora'; sid: string; boleto: string };

export function useCanal<E extends Estado>(destino: Destino | null): { estado: E | null; conectado: boolean } {
  const [estado, setEstado] = useState<E | null>(null);
  const [conectado, setConectado] = useState(false);
  const vista = useRef(0);
  const clave = destino ? JSON.stringify(destino) : '';

  useEffect(() => {
    if (!destino) return;
    let cerrado = false;
    let ws: WebSocket | null = null;
    let latido: ReturnType<typeof setInterval> | undefined;
    let reintento: ReturnType<typeof setTimeout> | undefined;
    let espera = 400;

    const reintentar = () => { if (!cerrado) { reintento = setTimeout(abrir, espera); espera = Math.min(espera * 2, 4000); } };

    const abrir = async () => {
      const q = new URLSearchParams({ rol: destino.rol, sid: destino.sid });
      if (destino.rol === 'participante') q.set('pase', destino.pase);
      else if (destino.rol === 'grabadora') q.set('t', destino.boleto);
      else {
        // El equipo abre el canal con un boleto de 60 s que pide por HTTP (ahí se verifica su sesión); en cada reconexión pide uno nuevo.
        try { q.set('boleto', (await api.boletoEquipo(destino.sid)).boleto); } catch { reintentar(); return; }
        if (cerrado) return;
      }
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${q}`);
      ws.onopen = () => {
        setConectado(true); espera = 400; vista.current = 0; // tras reconectar se acepta la primera vista que llegue
        latido = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 20000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        try {
          const msg = JSON.parse(String(ev.data)) as E;
          if (msg.tipo === 'estado' && msg.v > vista.current) { vista.current = msg.v; traza('estado', { v: msg.v, lugar: msg.rol === 'participante' ? msg.yo.lugar : undefined }); setEstado(msg); }
        } catch { /* mensaje que no entendemos: se ignora */ }
      };
      ws.onclose = () => {
        setConectado(false);
        clearInterval(latido);
        reintentar();
      };
    };
    void abrir();
    return () => { cerrado = true; clearInterval(latido); clearTimeout(reintento); ws?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return { estado, conectado };
}
