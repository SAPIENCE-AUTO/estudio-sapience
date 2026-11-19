import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RespuestaCanje } from '../../compartido/tipos';
import { api, ErrorApi } from '../lib/api';
import { guardarAccesoHub } from '../lib/acceso';

// El pase de un solo uso llega en la parte «#c=…» de la dirección (así no pasa por ningún servidor ni registro). Se lee UNA vez, se quita de la
// dirección en seguida y se cambia por la sesión. El canje se guarda a nivel de módulo: en desarrollo React monta la pantalla dos veces y,
// si se canjeara dos veces, la segunda fallaría porque el pase ya se gastó.
let canje: Promise<RespuestaCanje> | null = null;
function iniciarCanje(): Promise<RespuestaCanje> {
  if (canje) return canje;
  const codigo = new URLSearchParams(location.hash.replace(/^#/, '')).get('c');
  history.replaceState(null, '', location.pathname);
  canje = codigo ? api.canjearAcceso(codigo) : Promise.reject(new ErrorApi(400, 'SIN_PASE', 'Este acceso ya no sirve. Ábrelo otra vez desde el Hub'));
  return canje;
}

/** Solo rutas internas de Talks: nunca se navega a una dirección de afuera aunque el servidor la mandara. */
const destinoSeguro = (d: string): string => (/^\/(?!\/)[A-Za-z0-9_\-/]*$/.test(d) ? d : '/');

/** Entrada directa desde el Hub: cambia el pase por la sesión del equipo y pasa a la consola, sin pedir correo. */
export default function EntrarHub() {
  const navegar = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    iniciarCanje().then((r) => {
      guardarAccesoHub({ token: r.token, email: r.email, nombre: r.nombre, venceEn: r.venceEn });
      if (vivo) navegar(destinoSeguro(r.destino), { replace: true });
    }, (e: unknown) => {
      if (vivo) setError(e instanceof ErrorApi && e.estado !== 500 ? e.message : 'No pudimos darte el acceso. Ábrelo otra vez desde el Hub');
    });
    return () => { vivo = false; };
  }, [navegar]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1 className="text-xl font-semibold">Talks</h1>
      {error ? (
        <div className="rounded-2xl border border-borde bg-tarjeta p-5" data-testid="entrar-hub-error">
          <h2 className="text-lg font-semibold">No pudimos abrir Talks desde el Hub</h2>
          <p className="mt-2 text-sm text-tenue">{error}</p>
          <button className="mt-4 h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-white" onClick={() => navegar('/', { replace: true })}>Entrar con mi correo</button>
        </div>
      ) : (
        <p className="text-sm text-tenue" data-testid="entrar-hub-cargando">Entrando…</p>
      )}
    </div>
  );
}
