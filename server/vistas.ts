// Lo que cada quien puede ver de la sesión. El participante NUNCA recibe la lista completa:
// solo lo suyo, el equipo y quién está en el escenario (porque eso lo ve todo el mundo de todos modos).
import { normalizarDiseno, type EstadoEquipo, type EstadoParticipante } from '../compartido/tipos';
import type { Sesion } from './dominio';

export function estadoParaEquipo(s: Sesion, yo: string): EstadoEquipo {
  return {
    tipo: 'estado', rol: 'equipo', v: s.version, yo,
    sesion: { id: s.id, nombre: s.nombre, codigo: s.codigo, terminada: s.terminada },
    participantes: Object.values(s.participantes)
      .sort((a, b) => a.entroEn - b.entroEn)
      .map((p) => ({ id: p.id, nombre: p.nombre, lugar: p.lugar, verdeCon: p.verdeCon, conectado: p.conectado, entroEn: p.entroEn, silenciado: !!p.silenciado })),
    equipo: Object.values(s.equipo).map((m) => ({ id: m.id, nombre: m.nombre, enEscenario: m.enEscenario, conectado: m.conectado })),
    diseno: normalizarDiseno(s.diseno),
  };
}

export function estadoParaParticipante(s: Sesion, pid: string): EstadoParticipante | null {
  const p = s.participantes[pid];
  if (!p) return null;
  return {
    tipo: 'estado', rol: 'participante', v: s.version,
    sesion: { nombre: s.nombre, terminada: s.terminada },
    yo: { id: p.id, nombre: p.nombre, lugar: p.lugar, verdeCon: p.verdeCon, silenciado: !!p.silenciado },
    equipo: Object.values(s.equipo).map((m) => ({ id: m.id, nombre: m.nombre, enEscenario: m.enEscenario })),
    escenario: Object.values(s.participantes).filter((q) => q.lugar === 'escenario').map((q) => ({ id: q.id, nombre: q.nombre })),
    diseno: normalizarDiseno(s.diseno),
  };
}
