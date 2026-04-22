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

console.log('=== Listo. Recarga la web (http://localhost:7777) para ver los datos nuevos ===');
