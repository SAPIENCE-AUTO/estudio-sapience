// Cámara y micrófono sintéticos para las pruebas con Chrome sin ventana (ahí no se pueden abrir los de verdad, ni los de mentira que trae):
// un cuadro blanco que se mueve sobre fondo verde, y un tono. Lo que se prueba es nuestro código y LiveKit; la apertura de la cámara real
// la hace el navegador y se revisa a mano en celulares y computadoras de verdad.
// `ancho` y `alto` dan la forma de la cámara: 640×360 es una laptop; 360×640 es un celular en vertical.
export function mediosFalsos(ancho = 640, alto = 360): string {
  return `(() => {
  window.__TRAZA = true;
  window.__pedidos = []; // lo que la página le pidió a la cámara (para revisar que en celular no se fuerza una forma)
  window.__flujos = []; // los flujos que abrió (para revisar cuáles siguen vivos)
  let contexto = null;
  const crearFlujo = (video, audio) => {
    const flujo = new MediaStream();
    if (video) {
      const A = ${ancho}, H = ${alto};
      const c = document.createElement('canvas'); c.width = A; c.height = H;
      const x = c.getContext('2d'); let n = 0;
      setInterval(() => { x.fillStyle = '#2a6f5a'; x.fillRect(0, 0, A, H); x.fillStyle = '#ffffff'; x.fillRect((n * 8) % (A - 40), H - 80, 40, 40); n++; }, 66);
      c.captureStream(15).getVideoTracks().forEach((t) => flujo.addTrack(t));
    }
    if (audio) {
      contexto = contexto || new AudioContext();
      const osc = contexto.createOscillator(); const g = contexto.createGain(); g.gain.value = 0.02;
      const d = contexto.createMediaStreamDestination(); osc.connect(g); g.connect(d); osc.start();
      d.stream.getAudioTracks().forEach((t) => flujo.addTrack(t));
    }
    window.__flujos.push(flujo);
    return flujo;
  };
  // __retardoCamara (ms) simula una cámara real que tarda en arrancar en frío
  navigator.mediaDevices.getUserMedia = async (c) => { if (c && c.video) window.__pedidos.push(JSON.stringify(c.video)); if (c && c.video && window.__retardoCamara) await new Promise((r) => setTimeout(r, window.__retardoCamara)); return crearFlujo(!!(c && c.video), !!(c && c.audio)); };
  navigator.mediaDevices.enumerateDevices = async () => [
    { deviceId: 'cam-de-prueba', kind: 'videoinput', label: 'Cámara de prueba', groupId: 'g1' },
    { deviceId: 'mic-de-prueba', kind: 'audioinput', label: 'Micrófono de prueba', groupId: 'g1' },
  ];
})();`;
}
