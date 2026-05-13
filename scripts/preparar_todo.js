/**
 * Prepara todos los datos: residuos + cámaras.
 * Ejecutar cada vez que subas archivos nuevos.
 *
 * Uso: npm run preparar
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

console.log('=== Preparando datos Peñíscola ===\n');

// 0. GeoJSON zonas desde Areas Zona.xlsx (si existe)
console.log('0. Zonas (Areas Zona.xlsx → zonas_peniscola.geojson)...');
try {
  execSync('node scripts/areas_zona_a_geojson.js', { cwd: root, stdio: 'inherit' });
  console.log('   ✓ Zonas listo\n');
} catch (e) {
  console.warn('   ⚠ Zonas Excel:', e.message, '\n');
}

// 1. Residuos (Python)
console.log('1. Residuos (preparar_datos.py)...');
try {
  execSync('python preparar_datos.py', { cwd: root, stdio: 'inherit' });
  console.log('   ✓ Residuos listo\n');
} catch (e) {
  console.warn('   ⚠ Error en residuos (¿tienes Python y pandas?):', e.message);
  console.log('   Continúo con cámaras...\n');
}

// 2. Cámaras (Node)
console.log('2. Cámaras (procesar_camaras.js)...');
try {
  execSync('node procesar_camaras.js', { cwd: root, stdio: 'inherit' });
  console.log('   ✓ Cámaras listo\n');
} catch (e) {
  console.warn('   ⚠ Error en cámaras:', e.message);
}

// 3. Turismo (Node) — descarga datos INE
console.log('3. Turismo (procesar_turismo.js)...');
try {
  execSync('node procesar_turismo.js', { cwd: root, stdio: 'inherit' });
  console.log('   ✓ Turismo listo\n');
} catch (e) {
  console.warn('   ⚠ Error en turismo (¿sin conexión a INE?):', e.message);
}

console.log('=== Listo. Recarga la web (http://localhost:7777) para ver los datos nuevos ===');
