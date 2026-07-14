/**
 * Actualización mensual "todo en uno" del cuadro de mando.
 *
 * Hace, en orden y sin parar aunque falle un paso:
 *   1. Descarga del camión (API Sigeus) del mes anterior + mes actual (parcial).
 *   2. Residuos (preparar_datos.py): reprocesa camión + pesajes.
 *   3. Cámaras (procesar_camaras.js): reprocesa los CSV que haya (LPR + aforo).
 *   4. Turismo INE (procesar_turismo.js).
 *   5. Viviendas turísticas GVA (procesar_viviendas.js).
 *
 * Al final imprime hasta qué mes llega cada fuente y qué queda por meter a mano.
 *
 * Uso:  npm run actualizar     (o: node scripts/actualizar_datos.js)
 *
 * NO sube nada a git (eso lo decide quien lo ejecuta). Los CSV/Excel nuevos de
 * pesajes y cámaras hay que dejarlos antes en sus carpetas (se avisa al final).
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pasos = [];

function run(desc, cmd, args) {
  process.stdout.write(`\n▶ ${desc}\n`);
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
    pasos.push({ desc, ok: true });
  } catch (e) {
    pasos.push({ desc, ok: false, err: (e.message || '').split('\n')[0] });
    process.stdout.write(`  ⚠ Falló: ${(e.message || '').split('\n')[0]}\n`);
  }
}

function mesRel(delta) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function leerJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch (_) { return null; }
}

function ultimoMesCamion() {
  const d = leerJson('data/camaras/todos.json'); // no aplica; camión está en RESIDUOS
  const arr = leerJson('data/RESIDUOS/camion/JSON/' + new Date().getFullYear() + '/Residus_' + new Date().getFullYear() + '.json');
  if (!Array.isArray(arr) || !arr.length) return '—';
  const meses = [...new Set(arr.map((r) => String(r.FullDateUtc).slice(0, 6)))].sort();
  const m = meses[meses.length - 1];
  return m ? `${m.slice(0, 4)}-${m.slice(4, 6)}` : '—';
}

function resumenFinal() {
  console.log('\n\n===================  RESUMEN  ===================');
  pasos.forEach((p) => console.log(`${p.ok ? '✅' : '⚠️ '} ${p.desc}${p.ok ? '' : '  (' + p.err + ')'}`));

  console.log('\n--- Hasta qué mes llega cada fuente ---');
  // Camión
  console.log('🚛 Camión:      ' + ultimoMesCamion());
  // Residuos resumen (pesajes)
  const resid = leerJson('data/RESIDUOS/resumen.json');
  try {
    const pes = (resid && resid.pesajes) ? resid.pesajes : null;
    const clave = pes ? Object.keys(pes).find((k) => /mes|periodo/i.test(k)) : null;
    console.log('⚖️  Pesajes:     ' + (pes ? 'ver dashboard (resumen.json)' : '—'));
  } catch (_) {}
  // Turismo
  const tur = leerJson('data/TURISMO/todos.json');
  const tMes = tur && tur.resumen && tur.resumen.hoteles ? tur.resumen.hoteles.ultimoMes : '—';
  console.log('🏨 Turismo INE: ' + (tMes || '—'));
  // Viviendas
  const viv = leerJson('data/TURISMO/viviendas.json');
  console.log('🏡 Viviendas:   ' + (viv ? (viv.totalViviendas || (viv.viviendas ? viv.viviendas.length : '') || 'ok') + ' viviendas' : '—'));
  // Cámaras
  const cam = leerJson('data/camaras/todos.json');
  if (cam && cam.lpr && cam.lpr.porMes) {
    const m = Object.keys(cam.lpr.porMes).sort();
    console.log('📷 Cámaras LPR: ' + (m.length ? m[m.length - 1] : '—'));
  }
  if (cam && Array.isArray(cam.multiobjeto)) {
    const f = [...new Set(cam.multiobjeto.map((r) => r.fecha))].sort();
    console.log('👥 Aforo:       ' + (f.length ? f[f.length - 1] : '—'));
  }

  console.log('\n--- Pendiente de meter A MANO (dejar los ficheros y reejecutar) ---');
  console.log('⚖️  Pesajes:  Excel del mes en  data/RESIDUOS/pesajes/<año>/  ("MM - Pesajes <mes> YY.xlsx")');
  console.log('📷 Cámaras:  CSV export de HikCentral en  data/camaras/Trafico_camaras/CSV/  (LPR)  y  data/camaras/Camaras_Multiobjeto/CSV/<cámara>/  (aforo)');
  console.log('\n--- Fuentes externas (no automatizables desde aquí) ---');
  console.log('🌐 Google Analytics:  reconectar OAuth si marca invalid_grant.');
  console.log('💳 SIT CV (gasto/búsquedas/reputación):  pendiente feed de Invat·tur.');
  console.log('💧 Agua:  pendiente fichero del servicio municipal.');
  console.log('\n➡️  Si todo se ve bien en local (http://localhost:7777), commitea solo los datos ligeros');
  console.log('    (NO data/RESIDUOS/camion/mapa_sample.json, pesa >100MB) y haz push.');
  console.log('================================================\n');
}

(function main() {
  console.log('===== ACTUALIZACIÓN MENSUAL DEL CUADRO DE MANDO =====');
  const mesAnterior = mesRel(-1);
  const mesActual = mesRel(0);

  // 1. Camión (Sigeus) — mes anterior completo + mes actual parcial
  run(`Camión Sigeus ${mesAnterior}`, 'node', ['descargar_camion.js', mesAnterior]);
  run(`Camión Sigeus ${mesActual} (parcial)`, 'node', ['descargar_camion.js', mesActual]);

  // 2-5. Resto (residuos, cámaras, turismo, viviendas) via el orquestador existente
  run('Residuos (preparar_datos.py)', 'python', ['preparar_datos.py']);
  run('Cámaras (procesar_camaras.js)', 'node', ['procesar_camaras.js']);
  run('Turismo INE (procesar_turismo.js)', 'node', ['procesar_turismo.js']);
  run('Viviendas GVA (procesar_viviendas.js)', 'node', ['procesar_viviendas.js']);

  // Detección de cámaras nuevas/desaparecidas (avisa cuando instalan LPR nuevas)
  run('Detección de cámaras (nuevas/desaparecidas)', 'node', ['scripts/detectar_camaras_nuevas.js']);

  resumenFinal();
})();
