import { Route, Routes } from 'react-router-dom';
import Inicio from './pages/Inicio';
import Participante from './pages/Participante';
import Consola from './pages/Consola';
import ProtegidoEquipo from './components/ProtegidoEquipo';

// Los participantes (/p/…) entran sin cuenta con su link; todo lo demás es del equipo y pide su sesión.
export default function App() {
  return (
    <Routes>
      <Route path="/p/:codigo" element={<Participante />} />
      <Route path="/equipo/:sid" element={<ProtegidoEquipo><Consola /></ProtegidoEquipo>} />
      <Route path="*" element={<ProtegidoEquipo><Inicio /></ProtegidoEquipo>} />
    </Routes>
  );
}
