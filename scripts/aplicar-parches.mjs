// Aplica los cambios de texto de scripts/parches.json en archivos de rutas muy profundas
// (app/(platform)/…/page.tsx), adonde Claude no llega a escribir desde la nube.
// Solo reemplaza el texto exacto indicado; si no lo encuentra, no toca el archivo.
// Antes de cambiar un archivo guarda una copia en scripts/parches-respaldo/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(ROOT, 'scripts', 'parches-respaldo');
const parches = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'parches.json'), 'utf8'));

let changed = 0;
let missing = 0;
for (const { archivo, cambios } of parches) {
  const file = path.join(ROOT, ...archivo.split('/'));
  if (!existsSync(file)) {
    console.log(`NO EXISTE  ${archivo}`);
    missing++;
    continue;
  }
  const original = readFileSync(file, 'utf8');
  let text = original;
  for (const { antes, despues } of cambios) {
    if (text.includes(despues)) console.log(`ya estaba  ${archivo}: ${despues.slice(0, 60)}…`);
    else if (text.includes(antes)) {
      text = text.replace(antes, despues);
      console.log(`cambiado   ${archivo}: ${despues.slice(0, 60)}…`);
    } else {
      console.log(`NO ENCONTRÉ el texto en ${archivo}: ${antes.slice(0, 60)}…`);
      missing++;
    }
  }
  if (text !== original) {
    mkdirSync(BACKUP, { recursive: true });
    copyFileSync(file, path.join(BACKUP, `${archivo.replace(/[\\/():[\]]+/g, '_')}.${Date.now()}.bak`));
    writeFileSync(file, text, 'utf8');
    changed++;
  }
}

console.log(`\nListo: ${changed} archivo(s) cambiados${missing ? `, ${missing} aviso(s) arriba` : ''}.`);
console.log('Ahora cierra AutoMarket y ábrelo otra vez para que la página tome los cambios.');
