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

// ---- Acceso directo desde el Hub: Talks da una sesión del equipo a cambio del pase de un solo uso (ver server/accesoHub.ts) ----
const CLAVE_ACCESO_HUB = 'talks:acceso-hub';
export interface AccesoHub { token: string; email: string; nombre: string; venceEn: number }

export function guardarAccesoHub(a: AccesoHub): void {
  try { localStorage.setItem(CLAVE_ACCESO_HUB, JSON.stringify(a)); } catch { /* sin almacenamiento: la sesión vale solo en esta pantalla */ }
}

/** La sesión que dio el Hub, si existe y no ha vencido. */
export function leerAccesoHub(): AccesoHub | null {
  try {
    const texto = localStorage.getItem(CLAVE_ACCESO_HUB);
    if (!texto) return null;
    const a = JSON.parse(texto) as Partial<AccesoHub>;
    if (typeof a.token === 'string' && typeof a.venceEn === 'number' && a.venceEn > Date.now() && typeof a.email === 'string' && typeof a.nombre === 'string') return a as AccesoHub;
    localStorage.removeItem(CLAVE_ACCESO_HUB);
  } catch { /* ilegible: es como no tener sesión */ }
  return null;
}

export function borrarAccesoHub(): void {
  try { localStorage.removeItem(CLAVE_ACCESO_HUB); } catch { /* nada que borrar */ }
}

/** El token de la sesión del equipo, o null si no hay login (modo dev, o todavía no ha entrado). La del Hub, si la hay, va primero. */
export async function tokenDeEquipo(): Promise<string | null> {
  const c = await configPublica().catch(() => null);
  if (c?.authMode !== 'supabase') return null;
  const delHub = leerAccesoHub();
  if (delHub) return delHub.token;
  const { data } = await (await clienteSupabase()).auth.getSession();
  return data.session?.access_token ?? null;
}

/** Cierra las dos formas de entrar (la del Hub y la del correo) y avisa a la pantalla para que vuelva a pedir el acceso. */
export async function cerrarSesionEquipo(): Promise<void> {
  borrarAccesoHub();
  const c = await configPublica().catch(() => null);
  if (c?.authMode !== 'supabase') return;
  try { await (await clienteSupabase()).auth.signOut(); } finally { window.dispatchEvent(new Event(EVENTO_SALIO)); }
}

/** Lo dispara «Salir»; ProtegidoEquipo lo escucha (Supabase no siempre avisa si lo que se cerró fue la sesión del Hub). */
export const EVENTO_SALIO = 'talks:salio';
