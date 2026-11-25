import { describe, expect, it } from 'vitest';
import { mismosPermitidos, permisosDePistas, type Permitidos, type PistaPropia } from '../src/lib/permisos';

const PISTAS: PistaPropia[] = [
  { sid: 'TR_cam', esPantalla: false }, { sid: 'TR_mic', esPantalla: false },
  { sid: 'TR_pant', esPantalla: true }, { sid: 'TR_pant_audio', esPantalla: true },
];
const veA = (r: ReturnType<typeof permisosDePistas>, id: string) => r.porPersona.find((p) => p.participantIdentity === id);

describe('mismos grupos', () => {
  it('«todos» solo es igual a «todos»', () => {
    expect(mismosPermitidos('todos', 'todos')).toBe(true);
    expect(mismosPermitidos('todos', ['a'])).toBe(false);
    expect(mismosPermitidos(['a'], 'todos')).toBe(false);
  });
  it('las listas se comparan sin importar el orden', () => {
    expect(mismosPermitidos(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(mismosPermitidos(['a', 'b'], ['a'])).toBe(false);
    expect(mismosPermitidos(['a'], ['b'])).toBe(false);
    expect(mismosPermitidos([], [])).toBe(true);
  });
});

describe('cuando la pantalla y lo demás van al mismo grupo (como siempre)', () => {
  it('«todos»: todos reciben todo', () => {
    expect(permisosDePistas({ permitidos: 'todos', pantalla: 'todos', conocidos: ['x', 'y'], pistas: PISTAS })).toEqual({ todos: true, porPersona: [] });
  });
  it('una lista: esas personas reciben todo y nadie más', () => {
    const r = permisosDePistas({ permitidos: ['eq1', 'eq2'], pantalla: ['eq2', 'eq1'], conocidos: ['eq1', 'eq2', 'p1'], pistas: PISTAS });
    expect(r.todos).toBe(false);
    expect(r.porPersona).toEqual([{ participantIdentity: 'eq1', allowAll: true }, { participantIdentity: 'eq2', allowAll: true }]);
  });
});

describe('cuando la pantalla va a un grupo distinto', () => {
  it('moderador en backstage con la pantalla solo para el equipo: nadie más recibe la pantalla', () => {
    const r = permisosDePistas({ permitidos: ['eq2'], pantalla: ['eq2'], conocidos: ['eq2', 'p1'], pistas: PISTAS });
    expect(veA(r, 'p1')).toBeUndefined(); // un participante no recibe NADA
    expect(veA(r, 'eq2')).toEqual({ participantIdentity: 'eq2', allowAll: true });
  });

  it('en el escenario con la pantalla solo en backstage: todos reciben cámara y micrófono, pero NO la pantalla; el equipo recibe todo', () => {
    const r = permisosDePistas({ permitidos: 'todos', pantalla: ['eq2'], conocidos: ['eq2', 'p1', 'p2'], pistas: PISTAS });
    expect(r.todos).toBe(false);
    expect(veA(r, 'eq2')).toEqual({ participantIdentity: 'eq2', allowAll: true });
    for (const p of ['p1', 'p2']) {
      expect(veA(r, p)?.allowedTrackSids).toEqual(['TR_cam', 'TR_mic']);
      expect(veA(r, p)?.allowedTrackSids).not.toContain('TR_pant');
      expect(veA(r, p)?.allowedTrackSids).not.toContain('TR_pant_audio');
    }
  });

  it('con alguien en la sala verde y la pantalla en el escenario: la pantalla llega a todos, la cámara solo a quien está en la sala verde y al equipo', () => {
    const r = permisosDePistas({ permitidos: ['eq2', 'pVerde'], pantalla: 'todos', conocidos: ['eq2', 'pVerde', 'pOtro', 'pEscena'], pistas: PISTAS });
    expect(veA(r, 'eq2')).toEqual({ participantIdentity: 'eq2', allowAll: true });
    expect(veA(r, 'pVerde')).toEqual({ participantIdentity: 'pVerde', allowAll: true });
    for (const p of ['pOtro', 'pEscena']) expect(veA(r, p)?.allowedTrackSids).toEqual(['TR_pant', 'TR_pant_audio']); // solo la pantalla, NUNCA la cámara ni el micrófono
    for (const p of ['pOtro', 'pEscena']) expect(veA(r, p)?.allowedTrackSids).not.toContain('TR_cam');
  });

  it('la pantalla en el escenario y la cámara también en el escenario: es el mismo grupo («todos»), sin listas', () => {
    expect(permisosDePistas({ permitidos: 'todos', pantalla: 'todos', conocidos: ['a'], pistas: PISTAS })).toEqual({ todos: true, porPersona: [] });
  });

  it('cuando todavía no hay pistas publicadas, nadie fuera del grupo recibe nada (lo nuevo queda bloqueado, no abierto)', () => {
    const r = permisosDePistas({ permitidos: 'todos', pantalla: ['eq2'], conocidos: ['eq2', 'p1'], pistas: [] });
    expect(veA(r, 'p1')?.allowedTrackSids).toEqual([]);
    expect(r.todos).toBe(false);
  });

  it('quien está en una lista pero todavía no llegó a la sala igual queda registrado (para cuando entre)', () => {
    const r = permisosDePistas({ permitidos: ['eq9'], pantalla: 'todos', conocidos: ['p1'], pistas: PISTAS });
    expect(veA(r, 'eq9')).toEqual({ participantIdentity: 'eq9', allowAll: true });
    expect(veA(r, 'p1')?.allowedTrackSids).toEqual(['TR_pant', 'TR_pant_audio']);
  });

  it('nunca da «todos» cuando los grupos son distintos (si no, la pantalla se filtraría)', () => {
    const casos: [Permitidos, Permitidos][] = [['todos', ['eq2']], [['eq2'], 'todos'], [['a'], ['b']]];
    for (const [a, b] of casos) {
      expect(permisosDePistas({ permitidos: a, pantalla: b, conocidos: ['a', 'b', 'p'], pistas: PISTAS }).todos).toBe(false);
    }
  });
});
