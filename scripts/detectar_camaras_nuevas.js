/**
 * Detecta cámaras NUEVAS (o desaparecidas) comparando las que aparecen en los
 * datos procesados (data/camaras/todos.json) con una lista conocida de
 * referencia (data/camaras/camaras_conocidas.json).
 *
 * Uso:
 *   node scripts/detectar_camaras_nuevas.js            (solo informa)
 *   node scripts/detectar_camaras_nuevas.js --guardar  (informa y ACTUALIZA la
 *                                                        lista conocida al estado actual)
 *
 * Si la lista conocida no existe, la crea con el estado actual (línea base).
 * Pensado para llamarse tras cada reproceso/actualización: avisa cuando
 * instalan una LPR nueva (o una cámara de aforo nueva).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DATA = path.join(root, 'data', 'camaras', 'todos.json');
const BASE = path.join(root, 'data', 'camaras', 'camaras_conocidas.json');
const guardar = process.argv.includes('--guardar');

function camarasActuales() {
  const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const lpr = Object.keys((d.lpr && d.lpr.byCamara) || {}).sort();
  const aforo = [...new Set(((d.multiobjeto) || []).map((r) => r.camara))].sort();
  return { lpr, aforo };
}

function diff(actual, conocida) {
  const setC = new Set(conocida);
  const setA = new Set(actual);
  return {
    nuevas: actual.filter((c) => !setC.has(c)),
    desaparecidas: conocida.filter((c) => !setA.has(c)),
  };
}

function main() {
  const actual = camarasActuales();

  if (!fs.existsSync(BASE)) {
    fs.writeFileSync(BASE, JSON.stringify({ actualizado: null, lpr: actual.lpr, aforo: actual.aforo }, null, 2));
    console.log('ℹ️  Línea base creada con el estado actual:');
    console.log('   LPR:', actual.lpr.length, '| Aforo:', actual.aforo.length, 'cámaras.');
    console.log('   (a partir de ahora se avisará de cualquier cámara nueva)');
    return { hayCambios: false, actual };
  }

  const conocida = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const dLpr = diff(actual.lpr, conocida.lpr || []);
  const dAf = diff(actual.aforo, conocida.aforo || []);
  const hayCambios = dLpr.nuevas.length || dLpr.desaparecidas.length || dAf.nuevas.length || dAf.desaparecidas.length;

  console.log('=== Detección de cámaras ===');
  if (!hayCambios) {
    console.log('✅ Sin novedades. LPR:', actual.lpr.length, '| Aforo:', actual.aforo.length, 'cámaras (igual que la referencia).');
  } else {
    if (dLpr.nuevas.length) { console.log('\n🆕 LPR NUEVAS (' + dLpr.nuevas.length + '):'); dLpr.nuevas.forEach((c) => console.log('   • ' + c)); }
    if (dAf.nuevas.length) { console.log('\n🆕 AFORO NUEVAS (' + dAf.nuevas.length + '):'); dAf.nuevas.forEach((c) => console.log('   • ' + c)); }
    if (dLpr.desaparecidas.length) { console.log('\n⚠️  LPR que ya no aparecen (' + dLpr.desaparecidas.length + '):'); dLpr.desaparecidas.forEach((c) => console.log('   • ' + c)); }
    if (dAf.desaparecidas.length) { console.log('\n⚠️  AFORO que ya no aparecen (' + dAf.desaparecidas.length + '):'); dAf.desaparecidas.forEach((c) => console.log('   • ' + c)); }
    console.log('\n   → Si son correctas, ejecuta con --guardar para fijarlas como referencia');
    console.log('     y revisa que tengan coordenadas en data/camaras/camaras_coordenadas.json.');
  }

  if (guardar) {
    fs.writeFileSync(BASE, JSON.stringify({ actualizado: null, lpr: actual.lpr, aforo: actual.aforo }, null, 2));
    console.log('\n💾 Lista conocida actualizada al estado actual.');
  }
  return { hayCambios, actual };
}

if (require.main === module) main();
module.exports = { camarasActuales };
