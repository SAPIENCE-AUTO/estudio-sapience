// Cómo entra el equipo. En desarrollo no hay login (modo «dev»); en producción es un enlace por correo con el mismo
// Supabase del Hub. La librería de Supabase se carga solo cuando hace falta: los participantes nunca la descargan.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConfigPublica { authMode: 'dev' | 'supabase'; supabaseUrl?: string; supabaseAnonKey?: string }

let config$: Promise<ConfigPublica> | null = null;
export function configPublica(): Promise<ConfigPublica> {
  config$ ??= fetch('/api/config-publica')
    .then((r) => { if (!r.ok) throw new Error('No se pudo leer la configuración'); return r.json() as Promise<ConfigPublica>; })
    .catch((e) => { config$ = null; throw e; });
  return config$;
}

let cliente$: Promise<SupabaseClient> | null = null;
export function clienteSupabase(): Promise<SupabaseClient> {
  cliente$ ??= (async () => {
    const c = await configPublica();
    if (c.authMode !== 'supabase' || !c.supabaseUrl || !c.supabaseAnonKey) throw new Error('El acceso con correo no está activo');
    const { createClient } = await import('@supabase/supabase-js');
    // «implicit»: el enlace del correo también funciona si se abre en otro aparato u otro navegador.
    return createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
  })().catch((e) => { cliente$ = null; throw e; });
  return cliente$;
}

/** El token de la sesión del equipo, o null si no hay login (modo dev, o todavía no ha entrado). */
export async function tokenDeEquipo(): Promise<string | null> {
  const c = await configPublica().catch(() => null);
  if (c?.authMode !== 'supabase') return null;
  const { data } = await (await clienteSupabase()).auth.getSession();
  return data.session?.access_token ?? null;
}

export async function cerrarSesionEquipo(): Promise<void> {
  const c = await configPublica().catch(() => null);
  if (c?.authMode !== 'supabase') return;
  await (await clienteSupabase()).auth.signOut();
}
