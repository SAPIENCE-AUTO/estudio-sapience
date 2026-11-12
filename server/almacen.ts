// Guarda las sesiones en un archivo JSON para que un reinicio del servidor no las pierda.
// Provisional: cuando haya base de datos propia (Postgres) esto se reemplaza sin tocar el resto.
import fs from 'node:fs';
import path from 'node:path';
import type { Sesion } from './dominio';

const ARCHIVO = path.resolve('datos/sesiones.json');
let temporizador: NodeJS.Timeout | null = null;

export function cargar(): Record<string, Sesion> {
  try {
    const todas = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) as Record<string, Sesion>;
    // Tras un reinicio nadie está conectado todavía: se vuelve a marcar cuando abran el canal en vivo.
    for (const s of Object.values(todas)) {
      for (const p of Object.values(s.participantes)) p.conectado = false;
      for (const m of Object.values(s.equipo)) m.conectado = false;
    }
    return todas;
  } catch { return {}; }
}

export function guardarPronto(sesiones: Record<string, Sesion>): void {
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    try {
      fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
      const tmp = ARCHIVO + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(sesiones));
      fs.renameSync(tmp, ARCHIVO);
    } catch (e) { console.error('No se pudo guardar el estado:', (e as Error).message); }
  }, 250);
}
