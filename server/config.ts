import { z } from 'zod';

const esquema = z.object({
  LIVEKIT_WS_URL: z.string().startsWith('ws'),
  LIVEKIT_HTTP_URL: z.string().startsWith('http'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(8787),
  APP_SECRET: z.string().min(32, 'APP_SECRET debe tener al menos 32 caracteres'),
  URL_PUBLICA: z.string().default('http://localhost:5173'),
  AUTH_MODE: z.enum(['dev', 'supabase']).default('dev'),
  DEV_EQUIPO_EMAIL: z.string().default('equipo@ejemplo.test'),
  DEV_EQUIPO_NOMBRE: z.string().default('Equipo (dev)'),
  // Login real del equipo (AUTH_MODE=supabase): el mismo proyecto de Supabase del Hub. La llave «anon» es pública por diseño.
  SUPABASE_URL: z.string().default('').transform((s) => s.trim().replace(/\/+$/, '')),
  SUPABASE_ANON_KEY: z.string().default('').transform((s) => s.trim()),
  // Correos del equipo que pueden entrar, separados por coma, espacio o salto de línea.
  EQUIPO_PERMITIDO: z.string().default(''),
  HUB_API_KEY: z.string().default(''),
  // Base de datos donde se guardan las sesiones (la del proyecto de Supabase de Talks). Vacía = archivo local, solo para desarrollo.
  DATABASE_URL: z.string().default('').transform((s) => s.trim()),
  // A dónde se transmite el EN VIVO: el servidor RTMP de Mux (la llave de cada sala se agrega al final). Rara vez cambia.
  MUX_RTMP_URL: z.string().default('rtmps://global-live.mux.com:443/app').transform((s) => s.trim().replace(/\/+$/, '')),
  // Cuánto espera el servidor a que vuelva alguien que se desconectó antes de regresarlo al lobby (las redes flojas se reconectan solas).
  GRACIA_DESCONEXION_SEGUNDOS: z.coerce.number().min(1).default(30),
  NODE_ENV: z.string().default('development'),
});

const lectura = esquema.safeParse(process.env);
if (!lectura.success) {
  console.error('Configuración inválida (revisa .env contra .env.example):');
  for (const e of lectura.error.issues) console.error(` - ${e.path.join('.')}: ${e.message}`);
  process.exit(1);
}
export const config = lectura.data;

// El acceso sin login es solo para desarrollo: en producción el servidor se niega a arrancar así.
if (config.NODE_ENV === 'production' && config.AUTH_MODE === 'dev') {
  console.error('AUTH_MODE=dev no se permite con NODE_ENV=production.');
  process.exit(1);
}

// Con login real, sin estos datos nadie podría entrar: mejor no arrancar que arrancar roto.
if (config.AUTH_MODE === 'supabase') {
  const faltan: string[] = [];
  if (!config.SUPABASE_URL.startsWith('http')) faltan.push('SUPABASE_URL');
  if (!config.SUPABASE_ANON_KEY) faltan.push('SUPABASE_ANON_KEY');
  if (!config.EQUIPO_PERMITIDO.trim()) faltan.push('EQUIPO_PERMITIDO');
  if (faltan.length) {
    console.error(`AUTH_MODE=supabase necesita: ${faltan.join(', ')}.`);
    process.exit(1);
  }
}

// Los links que se mandan a la gente deben abrir desde cualquier celular: en producción, solo https.
if (config.NODE_ENV === 'production' && !config.URL_PUBLICA.startsWith('https://')) {
  console.error('URL_PUBLICA debe empezar con https:// en producción.');
  process.exit(1);
}

if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  console.warn('AVISO: sin DATABASE_URL las sesiones se guardan en un archivo y SE PIERDEN cuando Render reinicia o actualiza el servicio.');
}
