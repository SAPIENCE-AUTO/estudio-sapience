import { Route, Routes } from 'react-router-dom';
import Inicio from './pages/Inicio';
import Participante from './pages/Participante';
import Consola from './pages/Consola';
import ProtegidoEquipo from './components/ProtegidoEquipo';
import Grabadora from './pages/Grabadora';

// Los participantes (/p/…) entran sin cuenta con su link; /grabadora/… es la página que se transmite (entra con su boleto); todo lo demás es del equipo y pide su sesión.
export default function App() {
  return (
    <Routes>
      <Route path="/p/:codigo" element={<Participante />} />
      <Route path="/grabadora/:sid" element={<Grabadora />} />
      <Route path="/equipo/:sid" element={<ProtegidoEquipo><Consola /></ProtegidoEquipo>} />
      <Route path="*" element={<ProtegidoEquipo><Inicio /></ProtegidoEquipo>} />
    </Routes>
  );
}
