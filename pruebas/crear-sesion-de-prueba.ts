// Crea (o recupera) en Talks una sesión de prueba con la llave de transmisión de una sala de observación de PRUEBA, igual que lo haría el Hub.
// Las llaves van solo en el archivo local `.env.prueba` (no se sube a GitHub). No imprime ninguna llave.
//   npm run sesion:prueba

export {}; // lo vuelve un módulo (permite await arriba de todo)
const url = (process.env.TALKS_URL ?? '').trim().replace(/\/+$/, '');
const llaveDelHub = (process.env.TALKS_API_KEY ?? '').trim();
const llaveMux = (process.env.MUX_STREAM_KEY ?? '').trim();
const observacion = (process.env.OBSERVACION_URL ?? '').trim();

const faltan = [['TALKS_URL', url], ['TALKS_API_KEY', llaveDelHub], ['MUX_STREAM_KEY', llaveMux]].filter(([, v]) => !v).map(([k]) => k);
if (faltan.length) {
  console.error(`Faltan en .env.prueba: ${faltan.join(', ')}. Ábrelo, llénalo y vuelve a correr.`);
  process.exit(1);
}

const cuerpo: Record<string, string> = { nombre: 'Prueba de EN VIVO', externoId: 'prueba-envivo', muxStreamKey: llaveMux };
if (observacion.startsWith('https://')) cuerpo.observacionUrl = observacion;

try {
  const r = await fetch(`${url}/api/v1/sesiones`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${llaveDelHub}` }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60_000) });
  const texto = await r.text();
  if (!r.ok) {
    const limpio = texto.split(llaveMux).join('…').split(llaveDelHub).join('…').slice(0, 300);
    console.error(`Talks contestó ${r.status}: ${limpio}`);
    if (r.status === 401) console.error('La llave TALKS_API_KEY no es la misma que HUB_API_KEY en Render (servicio talks). Cópiala de nuevo, sin espacios.');
    process.exit(1);
  }
  const s = JSON.parse(texto) as { id: string; linkEquipo: string; linkParticipantes: string; transmision: string; yaExistia: boolean };
  console.log(s.yaExistia ? 'La sesión de prueba ya existía (se actualizó la llave):' : 'Sesión de prueba creada:');
  console.log(`  Equipo (tú, con tu correo):  ${s.linkEquipo}`);
  console.log(`  Participantes (celular):     ${s.linkParticipantes}`);
  console.log(`  Transmisión: ${s.transmision === 'lista' ? 'lista (Talks tiene la llave de Mux)' : 'SIN llave'}`);
} catch (e) {
  console.error('No se pudo hablar con Talks:', (e as Error).message, '\nRevisa TALKS_URL (https://, sin barra al final). Render puede tardar hasta un minuto en despertar: vuelve a intentar.');
  process.exit(1);
}
