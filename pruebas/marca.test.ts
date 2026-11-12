import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Regla de Sergio, la misma de sharpli.mx: lo que descargan los participantes no debe traer el nombre de la
// agencia, ni siquiera dentro del código. Todo lo que viaja al navegador sale de index.html, src/ y compartido/.
const RAIZ = process.cwd();

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : [ruta];
  });
}

describe('marca neutra para participantes', () => {
  it('ni la pantalla ni el código compartido dicen «Sapience»', () => {
    const rutas = [path.join(RAIZ, 'index.html'), ...archivos(path.join(RAIZ, 'src')), ...archivos(path.join(RAIZ, 'compartido'))];
    const culpables = rutas.filter((r) => /sapience/i.test(fs.readFileSync(r, 'utf8'))).map((r) => path.relative(RAIZ, r));
    expect(culpables).toEqual([]);
  });

  it('lo ya compilado en dist/ tampoco lo dice (solo si hay compilación)', () => {
    const dist = path.join(RAIZ, 'dist');
    if (!fs.existsSync(dist)) return;
    const culpables = archivos(dist)
      .filter((r) => /\.(html|js|css|svg|json|webmanifest)$/.test(r))
      .filter((r) => /sapience/i.test(fs.readFileSync(r, 'utf8')))
      .map((r) => path.relative(RAIZ, r));
    expect(culpables).toEqual([]);
  });
});
