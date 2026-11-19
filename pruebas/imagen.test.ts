import { describe, expect, it } from 'vitest';
import { ajusteDeImagen, esVertical, medidasPropias, opcionesDeCamara, posicionDeImagen, proporcionPropia, recorteVertical, restriccionesDeVideo } from '../src/lib/imagen';

const VERTICAL = { w: 360, h: 640 }; // celular en vertical (9:16)
const VERTICAL_4_3 = { w: 480, h: 640 }; // celular en vertical con la cámara estándar (3:4)
const HORIZONTAL = { w: 640, h: 360 }; // laptop (16:9)
const CELDA_16_9 = { w: 800, h: 450 };
const CELDA_CUADRADA = { w: 300, h: 300 };
const CELDA_VERTICAL = { w: 270, h: 480 };

describe('ajuste de la imagen en su recuadro', () => {
  it('un video vertical en un recuadro horizontal se muestra entero (no se le corta la cara)', () => {
    expect(ajusteDeImagen('llenar', VERTICAL, CELDA_16_9)).toBe('contain');
    expect(ajusteDeImagen('llenar', VERTICAL_4_3, CELDA_16_9)).toBe('contain');
  });

  it('un video vertical en un recuadro vertical se llena', () => {
    expect(ajusteDeImagen('llenar', VERTICAL, CELDA_VERTICAL)).toBe('cover');
  });

  it('un video horizontal se llena como siempre, en recuadros horizontales y cuadrados', () => {
    expect(ajusteDeImagen('llenar', HORIZONTAL, CELDA_16_9)).toBe('cover');
    expect(ajusteDeImagen('llenar', HORIZONTAL, CELDA_CUADRADA)).toBe('cover'); // círculos: solo pierde los lados
  });

  it('un video vertical muy ancho para el recuadro (9:16 en un cuadrado) también se muestra entero', () => {
    expect(ajusteDeImagen('llenar', VERTICAL, CELDA_CUADRADA)).toBe('contain');
  });

  it('un recorte chico (3:4 en un cuadrado, una cuarta parte) sí se acepta', () => {
    expect(ajusteDeImagen('llenar', VERTICAL_4_3, CELDA_CUADRADA)).toBe('cover');
  });

  it('«completo» (lo que elige el equipo) muestra todo siempre', () => {
    expect(ajusteDeImagen('completo', HORIZONTAL, CELDA_16_9)).toBe('contain');
    expect(ajusteDeImagen('completo', null, null)).toBe('contain');
  });

  it('mientras no se conocen las medidas se llena, como antes', () => {
    expect(ajusteDeImagen('llenar', null, CELDA_16_9)).toBe('cover');
    expect(ajusteDeImagen('llenar', VERTICAL, null)).toBe('cover');
    expect(ajusteDeImagen('llenar', { w: 0, h: 0 }, CELDA_16_9)).toBe('cover');
    expect(ajusteDeImagen('llenar', VERTICAL, { w: 0, h: 0 })).toBe('cover');
  });

  it('mide cuánto se perdería de arriba y abajo', () => {
    expect(recorteVertical(HORIZONTAL, CELDA_16_9)).toBeCloseTo(0, 5);
    expect(recorteVertical(VERTICAL, CELDA_16_9)).toBeCloseTo(1 - 0.5625 / (16 / 9), 3); // casi 68 %
    expect(recorteVertical(HORIZONTAL, CELDA_CUADRADA)).toBe(0); // lo de los lados no cuenta
  });

  it('al llenar un video vertical se apunta hacia arriba, donde está la cara; lo demás queda centrado', () => {
    expect(posicionDeImagen('cover', VERTICAL)).toBe('50% 25%');
    expect(posicionDeImagen('cover', HORIZONTAL)).toBeUndefined();
    expect(posicionDeImagen('contain', VERTICAL)).toBeUndefined();
    expect(posicionDeImagen('cover', null)).toBeUndefined();
  });

  it('reconoce el video vertical', () => {
    expect(esVertical(VERTICAL)).toBe(true);
    expect(esVertical(VERTICAL_4_3)).toBe(true);
    expect(esVertical(HORIZONTAL)).toBe(false);
    expect(esVertical({ w: 640, h: 640 })).toBe(false);
    expect(esVertical(null)).toBe(false);
  });
});

describe('recuadro propio con la forma de la cámara', () => {
  it('un celular vertical da un recuadro vertical y uno horizontal da uno horizontal', () => {
    expect(proporcionPropia(VERTICAL)).toBeCloseTo(9 / 16, 4);
    expect(proporcionPropia(VERTICAL_4_3)).toBeCloseTo(0.75, 4);
    expect(proporcionPropia(HORIZONTAL)).toBeCloseTo(16 / 9, 4);
  });

  it('sin video todavía queda horizontal (16:9), como antes', () => {
    expect(proporcionPropia(null)).toBeCloseTo(16 / 9, 4);
  });

  it('una forma exagerada se acota (nunca más angosta que 9:16 ni más ancha que 16:9)', () => {
    expect(proporcionPropia({ w: 100, h: 1000 })).toBeCloseTo(9 / 16, 4);
    expect(proporcionPropia({ w: 2000, h: 100 })).toBeCloseTo(16 / 9, 4);
  });

  it('las medidas respetan el ancho y el alto máximos', () => {
    const v = medidasPropias(VERTICAL, { anchoMax: '100%', altoMax: '42vh' });
    expect(v.aspectRatio).toBe('0.5625');
    expect(v.width).toBe('min(100%, calc(42vh * 0.5625))'); // vertical: manda el alto, no ocupa todo el ancho
    const h = medidasPropias(HORIZONTAL, { anchoMax: '100%', altoMax: '42vh' });
    expect(h.width).toBe('min(100%, calc(42vh * 1.7778))'); // horizontal: en un celular manda el ancho, igual que antes
  });
});

describe('qué se le pide a la cámara', () => {
  it('en computadora se pide 640×360 (ligero y horizontal)', () => {
    expect(restriccionesDeVideo('cam1', false)).toEqual({ deviceId: { exact: 'cam1' }, width: { ideal: 640 }, height: { ideal: 360 } });
    expect(restriccionesDeVideo(undefined, false)).toEqual({ width: { ideal: 640 }, height: { ideal: 360 } });
  });

  it('en celular NO se fuerza ni ancho ni alto (la cámara entrega su forma natural)', () => {
    expect(restriccionesDeVideo('cam1', true)).toEqual({ deviceId: { exact: 'cam1' } });
    expect(restriccionesDeVideo(undefined, true)).toEqual({});
  });

  it('la vista previa de la consola pide lo mismo que LiveKit al transmitir (1280×720), para que la cámara abierta se reutilice', () => {
    expect(restriccionesDeVideo(undefined, false, 'alta')).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 } });
    expect(restriccionesDeVideo('cam1', false, 'alta')).toEqual({ deviceId: { exact: 'cam1' }, width: { ideal: 1280 }, height: { ideal: 720 } });
    expect(restriccionesDeVideo('cam1', false)).toEqual({ deviceId: { exact: 'cam1' }, width: { ideal: 640 }, height: { ideal: 360 } }); // por defecto sigue ligera
    expect(restriccionesDeVideo('cam1', true, 'alta')).toEqual({ deviceId: { exact: 'cam1' } }); // en celular nunca se fuerza una forma
  });

  it('la cámara que se publica en la sala sigue la misma regla', () => {
    expect(opcionesDeCamara('cam1', false)).toEqual({ deviceId: 'cam1', resolution: { width: 640, height: 360, frameRate: 20 } });
    const cel = opcionesDeCamara('cam1', true);
    expect(cel.deviceId).toBe('cam1');
    expect(cel.resolution).toBeUndefined();
    expect('resolution' in cel).toBe(true); // la llave existe con valor vacío: así LiveKit no la rellena con su 1280×720 horizontal
  });
});
