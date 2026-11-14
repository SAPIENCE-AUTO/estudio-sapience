// Muestra qué dice LiveKit de las transmisiones (egress) de este proyecto: estado, hace cuánto empezaron y el error si lo hubo.
// Usa las llaves de LiveKit del .env local. Nunca imprime direcciones de transmisión ni llaves (se tachan).
//   npm run transmisiones
import { EgressClient, EgressStatus } from 'livekit-server-sdk';

const http = process.env.LIVEKIT_HTTP_URL ?? '';
const k = process.env.LIVEKIT_API_KEY ?? '';
const s = process.env.LIVEKIT_API_SECRET ?? '';
if (!http || !k || !s) { console.error('Faltan las llaves de LiveKit en .env'); process.exit(1); }

const tachar = (t: string) => t.replace(/rtmps?:\/\/\S+/gi, 'rtmp://(tachada)').replace(/[A-Za-z0-9-]{20,}/g, '…');
const egress = new EgressClient(http, k, s);
const todas = await egress.listEgress();
const ordenadas = [...todas].sort((a, b) => Number(b.startedAt ?? 0n) - Number(a.startedAt ?? 0n)).slice(0, 8);
if (!ordenadas.length) console.log('LiveKit no tiene ninguna transmisión registrada.');
for (const e of ordenadas) {
  const inicio = e.startedAt ? new Date(Number(e.startedAt / 1_000_000n)).toLocaleString('es-MX') : '(no llegó a empezar)';
  const estado = EgressStatus[e.status] ?? String(e.status);
  console.log(`${e.egressId.slice(0, 11)}…  ${estado}  inicio: ${inicio}${e.error ? `\n    error: ${tachar(e.error)}` : ''}`);
}
