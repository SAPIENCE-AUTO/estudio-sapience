// Cámara y micrófono del participante: lista de dispositivos, vista previa y medidor de micrófono.
import { useEffect, useRef, useState } from 'react';

export interface Dispositivos { camaras: MediaDeviceInfo[]; microfonos: MediaDeviceInfo[] }

export async function listarDispositivos(): Promise<Dispositivos> {
  const todos = await navigator.mediaDevices.enumerateDevices();
  return {
    camaras: todos.filter((d) => d.kind === 'videoinput'),
    microfonos: todos.filter((d) => d.kind === 'audioinput'),
  };
}

export type PermisoMedios = 'pendiente' | 'concedido' | 'negado' | 'sin-dispositivo';

/** Pide permiso una vez (si no, el navegador no revela los nombres de los dispositivos) y devuelve el resultado. */
export async function pedirPermiso(): Promise<PermisoMedios> {
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    flujo.getTracks().forEach((t) => t.stop());
    return 'concedido';
  } catch (e) {
    const nombre = (e as DOMException).name;
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'negado';
    return 'sin-dispositivo';
  }
}

/** Vista previa de la cámara elegida. Se apaga sola al salir o al cambiar de cámara. */
export function useVistaPrevia(camaraId: string | undefined, activa: boolean): MediaStream | null {
  const [flujo, setFlujo] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!activa) { setFlujo(null); return; }
    let cancelado = false;
    let actual: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: camaraId ? { deviceId: { exact: camaraId }, width: { ideal: 640 }, height: { ideal: 360 } } : { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false })
      .then((f) => { if (cancelado) { f.getTracks().forEach((t) => t.stop()); return; } actual = f; setFlujo(f); })
      .catch(() => setFlujo(null));
    return () => { cancelado = true; actual?.getTracks().forEach((t) => t.stop()); };
  }, [camaraId, activa]);
  return flujo;
}

/** Nivel del micrófono (0 a 1) para que la persona vea que la escuchan. */
export function useNivelMicrofono(microfonoId: string | undefined, activo: boolean): number {
  const [nivel, setNivel] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!activo) { setNivel(0); return; }
    let cancelado = false;
    let flujo: MediaStream | null = null;
    let contexto: AudioContext | null = null;
    navigator.mediaDevices
      .getUserMedia({ audio: microfonoId ? { deviceId: { exact: microfonoId } } : true, video: false })
      .then((f) => {
        if (cancelado) { f.getTracks().forEach((t) => t.stop()); return; }
        flujo = f;
        contexto = new AudioContext();
        const analizador = contexto.createAnalyser();
        analizador.fftSize = 512;
        contexto.createMediaStreamSource(f).connect(analizador);
        const datos = new Uint8Array(analizador.fftSize);
        const medir = () => {
          analizador.getByteTimeDomainData(datos);
          let suma = 0;
          for (const v of datos) { const x = (v - 128) / 128; suma += x * x; }
          setNivel(Math.min(1, Math.sqrt(suma / datos.length) * 4));
          raf.current = requestAnimationFrame(medir);
        };
        medir();
      })
      .catch(() => setNivel(0));
    return () => { cancelado = true; cancelAnimationFrame(raf.current); flujo?.getTracks().forEach((t) => t.stop()); void contexto?.close(); };
  }, [microfonoId, activo]);
  return nivel;
}
