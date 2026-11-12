import { useState } from 'react';
import { clienteSupabase } from '../lib/acceso';

function mensajeDe(e: unknown): string {
  const texto = e instanceof Error ? e.message : '';
  const estado = (e as { status?: number } | null)?.status;
  if (/signups? not allowed|user not found/i.test(texto)) return 'Ese correo no tiene acceso.';
  if (estado === 429 || /rate limit|too many/i.test(texto)) return 'Pediste varios enlaces seguidos. Espera un minuto e intenta de nuevo.';
  return 'No pudimos enviar el enlace. Revisa el correo e intenta de nuevo.';
}

/** Entrada del equipo: se escribe el correo y llega un enlace de acceso (sin contraseña). */
export default function Entrar({ aviso }: { aviso?: string }) {
  const [correo, setCorreo] = useState('');
  const [fase, setFase] = useState<'escribiendo' | 'enviando' | 'enviado'>('escribiendo');
  const [error, setError] = useState<string | null>(aviso ?? null);

  async function enviar() {
    const email = correo.trim();
    if (!email || fase === 'enviando') return;
    setFase('enviando');
    setError(null);
    try {
      const cliente = await clienteSupabase();
      const { error: err } = await cliente.auth.signInWithOtp({
        email,
        // Sin esto Supabase crearía una cuenta nueva para cualquier correo: quien es del equipo ya tiene la suya.
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false },
      });
      if (err) throw err;
      setFase('enviado');
    } catch (e) {
      setFase('escribiendo');
      setError(mensajeDe(e));
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1 className="text-xl font-semibold">Talks</h1>
      {fase === 'enviado' ? (
        <div className="rounded-2xl border border-borde bg-tarjeta p-5" data-testid="entrar-enviado">
          <h2 className="text-lg font-semibold">Revisa tu correo</h2>
          <p className="mt-2 text-sm text-texto">Mandamos tu enlace de acceso a <span className="font-semibold">{correo.trim()}</span>.</p>
          <p className="mt-2 text-[13px] text-tenue">Sirve una sola vez y vence pronto. Si no lo ves, revisa el correo no deseado.</p>
          <button className="mt-4 text-[13px] font-semibold text-teal underline underline-offset-2" onClick={() => { setFase('escribiendo'); setError(null); }}>
            Usar otro correo
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-3 rounded-2xl border border-borde bg-tarjeta p-5" onSubmit={(ev) => { ev.preventDefault(); void enviar(); }}>
          <p className="text-sm text-tenue">Te mandamos un enlace por correo. No necesitas contraseña.</p>
          <label htmlFor="correo" className="text-[12px] font-semibold uppercase tracking-wide text-tenue">Tu correo</label>
          <input id="correo" data-testid="entrar-correo" type="email" autoComplete="email" inputMode="email" autoFocus
            placeholder="tu@correo.com" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={fase === 'enviando'}
            className="h-12 w-full rounded-xl border border-borde-fuerte px-3 text-[15px]" />
          {error && <p className="text-[13px] text-peligro" role="alert" data-testid="entrar-error">{error}</p>}
          <button type="submit" data-testid="entrar-enviar" disabled={!correo.trim() || fase === 'enviando'}
            className="h-12 w-full rounded-xl bg-teal text-[15px] font-semibold text-white">
            {fase === 'enviando' ? 'Enviando…' : 'Enviar enlace de acceso'}
          </button>
        </form>
      )}
    </div>
  );
}
