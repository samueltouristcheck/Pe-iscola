/**
 * Procesa los pesajes mensuales de "Grandes Productores" (FOBESA) — kg de residuo
 * por establecimiento (hoteles, campings, aparthoteles) y fracción, mes a mes.
 *
 * Origen: data/RESIDUOS/grandes_productores/<año>/*.xlsx (uno por mes).
 * Los ficheros no son homogéneos: columnas desplazadas, nombres de fracción
 * distintos ("Envases" / "Envases mezclados", "Papel" / "Papel/Cartón"), alguna
 * tabla dinámica con fila "Total general" y hoja extra. Se localizan las columnas
 * por el texto de la cabecera y se saltan las filas de total.
 *
 * Salida: data/RESIDUOS/grandes_productores.json
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, 'data', 'RESIDUOS', 'grandes_productores');
const SALIDA = path.join(__dirname, 'data', 'RESIDUOS', 'grandes_productores.json');

const MESES = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
};

function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function limpiaNombre(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}
function mesDeNombre(fichero) {
  const n = norm(fichero);
  for (const m in MESES) if (n.includes(m)) return MESES[m];
  return null;
}
function fraccionDeCabecera(h) {
  const n = norm(h);
  if (n.includes('envas')) return 'envases';
  if (n.includes('organic')) return 'organica';
  if (n.includes('papel') || n.includes('carton')) return 'papel';
  return null;
}
function esTotal(nombre) {
  const n = norm(nombre);
  return n === '' || n.startsWith('total') || n.includes('total general');
}
function num(v) {
  if (v == null || v === '') return 0;
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  return isNaN(x) ? 0 : x;
}
function r2(x) { return Math.round(x * 100) / 100; }

function procesarFichero(abs) {
  const wb = XLSX.readFile(abs);
  const ws = wb.Sheets['Hoja1'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  // Fila de cabecera = primera que contiene alguna fracción reconocible
  let hi = rows.findIndex((r) => r.some((c) => fraccionDeCabecera(c)));
  if (hi < 0) hi = 0;
  const header = rows[hi];
  const cols = {}; // fraccion -> índice de columna
  header.forEach((c, i) => { const fr = fraccionDeCabecera(c); if (fr && cols[fr] == null) cols[fr] = i; });
  const out = {};
  for (let ri = hi + 1; ri < rows.length; ri++) {
    const fila = rows[ri];
    const nombre = fila[0];
    if (nombre == null || esTotal(nombre)) continue;
    const key = limpiaNombre(nombre);
    const envases = r2(num(fila[cols.envases]));
    const organica = r2(num(fila[cols.organica]));
    const papel = r2(num(fila[cols.papel]));
    const total = r2(envases + organica + papel);
    if (total === 0) continue; // filas vacías
    out[key] = { envases, organica, papel, total };
  }
  return out;
}

function main() {
  const datos = {};      // 'YYYY-MM' -> { estab -> {envases,organica,papel,total} }
  const anios = fs.readdirSync(BASE).filter((d) => /^\d{4}$/.test(d) && fs.statSync(path.join(BASE, d)).isDirectory());
  for (const yr of anios.sort()) {
    const dir = path.join(BASE, yr);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.xlsx?$/i.test(f)) continue;
      const mm = mesDeNombre(f);
      if (!mm) { console.warn('  ⚠ sin mes reconocible:', f); continue; }
      const ym = yr + '-' + mm;
      datos[ym] = procesarFichero(path.join(dir, f));
    }
  }
  const meses = Object.keys(datos).sort();
  // Unión de establecimientos
  const setEstab = new Set();
  meses.forEach((m) => Object.keys(datos[m]).forEach((e) => setEstab.add(e)));
  const establecimientos = Array.from(setEstab).sort((a, b) => a.localeCompare(b, 'es'));
  // Totales por mes y por establecimiento
  const totalesMes = {};
  const totalesEstab = {};
  establecimientos.forEach((e) => { totalesEstab[e] = { envases: 0, organica: 0, papel: 0, total: 0, meses: 0 }; });
  meses.forEach((m) => {
    const tm = { envases: 0, organica: 0, papel: 0, total: 0, establecimientos: 0 };
    Object.keys(datos[m]).forEach((e) => {
      const d = datos[m][e];
      tm.envases += d.envases; tm.organica += d.organica; tm.papel += d.papel; tm.total += d.total; tm.establecimientos++;
      const te = totalesEstab[e];
      te.envases += d.envases; te.organica += d.organica; te.papel += d.papel; te.total += d.total; te.meses++;
    });
    totalesMes[m] = { envases: r2(tm.envases), organica: r2(tm.organica), papel: r2(tm.papel), total: r2(tm.total), establecimientos: tm.establecimientos };
  });
  Object.keys(totalesEstab).forEach((e) => {
    const te = totalesEstab[e];
    te.envases = r2(te.envases); te.organica = r2(te.organica); te.papel = r2(te.papel); te.total = r2(te.total);
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const json = {
    fuente: 'FOBESA · Pesajes de grandes productores (hoteles, campings y aparthoteles) · Ayuntamiento de Peñíscola',
    nota: 'kg de residuo recogido por establecimiento y fracción (Envases mezclados, Orgánica, Papel/Cartón), un fichero por mes. Origen: SharePoint Ciudad › Residuos › Grandes Productores.',
    actualizado: hoy,
    fracciones: ['envases', 'organica', 'papel'],
    fraccionEtiqueta: { envases: 'Envases mezclados', organica: 'Orgánica', papel: 'Papel/Cartón' },
    meses,
    establecimientos,
    datos,
    totalesMes,
    totalesEstab
  };
  fs.writeFileSync(SALIDA, JSON.stringify(json, null, 2), 'utf8');
  console.log('✔ grandes_productores.json escrito');
  console.log('  meses:', meses.join(', '));
  console.log('  establecimientos:', establecimientos.length);
  const ult = meses[meses.length - 1];
  console.log('  último mes (' + ult + ') total kg:', totalesMes[ult].total, '· establecimientos:', totalesMes[ult].establecimientos);
}

if (require.main === module) main();
module.exports = { main };
