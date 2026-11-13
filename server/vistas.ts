// Lo que cada quien puede ver de la sesión. El participante NUNCA recibe la lista completa:
// solo lo suyo, el equipo y quién está en el escenario (porque eso lo ve todo el mundo de todos modos).
import { normalizarChat, normalizarDiseno, type EnVivo, type EstadoEquipo, type EstadoGrabadora, type EstadoParticipante, type MensajePublico } from '../compartido/tipos';
import type { Mensaje, Sesion } from './dominio';

/** Solo «desde cuándo»: el identificador interno de la transmisión no sale del servidor. */
const enVivoPublico = (s: Sesion): EnVivo | null => (s.envivo ? { desde: s.envivo.desde } : null);

const publico = (m: Mensaje, para: string): MensajePublico => ({ id: m.id, canal: m.canal, deId: m.deId, deNombre: m.deNombre, deRol: m.deRol, para, texto: m.texto, en: m.en });

/**
 * Lo que un participante puede leer. La regla depende de DÓNDE está ahora:
 * - En la sala verde: solo ese chat (lo suyo y lo que el equipo le escribió a él).
 * - En backstage o en el escenario, con el chat abierto: lo suyo, lo que el equipo escribió para todos o para él, y,
 *   si el mensaje de otro participante se escribió en modo grupal, también ese.
 * - En el lobby: nada.
 * NUNCA el chat del equipo, ni lo que otros le escribieron en privado al equipo, ni lo que el equipo contestó a otra persona.
 */
export function mensajesParaParticipante(s: Sesion, pid: string): MensajePublico[] {
  const p = s.participantes[pid];
  if (!p) return [];
  const dentro = p.lugar === 'backstage' || p.lugar === 'escenario';
  const abierto = normalizarChat(s.chat).abierto;
  return (s.mensajes ?? [])
    .filter((m) => {
      if (m.canal === 'verde') return p.lugar === 'verde' && (m.deId === pid || (m.deRol === 'equipo' && m.para === pid));
      if (m.canal === 'sesion') {
        return dentro && abierto && (m.deId === pid || (m.deRol === 'equipo' && (m.para === 'todos' || m.para === pid)) || (m.deRol === 'participante' && !!m.grupal));
      }
      return false;
    })
    .map((m) => publico(m, m.para === pid ? 'tu' : m.para));
}

export function estadoParaEquipo(s: Sesion, yo: string): EstadoEquipo {
  return {
    tipo: 'estado', rol: 'equipo', v: s.version, yo,
    sesion: { id: s.id, nombre: s.nombre, codigo: s.codigo, terminada: s.terminada },
    participantes: Object.values(s.participantes)
      .sort((a, b) => a.entroEn - b.entroEn)
      .map((p) => ({ id: p.id, nombre: p.nombre, lugar: p.lugar, verdeCon: p.verdeCon, conectado: p.conectado, entroEn: p.entroEn, silenciado: !!p.silenciado })),
    equipo: Object.values(s.equipo).map((m) => ({ id: m.id, nombre: m.nombre, enEscenario: m.enEscenario, conectado: m.conectado })),
    diseno: normalizarDiseno(s.diseno),
    chat: normalizarChat(s.chat),
    mensajes: (s.mensajes ?? []).map((m) => publico(m, m.para)),
    envivo: enVivoPublico(s),
    transmision: s.muxLlave ? 'lista' : 'sin-llave',
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
    chat: normalizarChat(s.chat),
    mensajes: mensajesParaParticipante(s, pid),
    envivo: enVivoPublico(s),
  };
}

/**
 * Lo que ve la página que se transmite: SOLO quién está en el escenario (equipo y participantes, con su nombre) y el diseño.
 * Todo lo demás (backstage, sala verde, lobby, chats) queda fuera, y la página solo muestra y escucha a esas personas.
 */
export function estadoParaGrabadora(s: Sesion): EstadoGrabadora {
  const equipo = Object.values(s.equipo).filter((m) => m.enEscenario).map((m) => ({ id: m.id, nombre: m.nombre }));
  const gente = Object.values(s.participantes).filter((p) => p.lugar === 'escenario').sort((a, b) => a.entroEn - b.entroEn).map((p) => ({ id: p.id, nombre: p.nombre }));
  return { tipo: 'estado', rol: 'grabadora', v: s.version, diseno: normalizarDiseno(s.diseno), escena: [...equipo, ...gente] };
}
