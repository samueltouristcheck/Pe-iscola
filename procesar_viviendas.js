/**
 * Descarga el registro oficial de viviendas de uso turístico de la
 * Comunitat Valenciana (publicado como datos abiertos por la Generalitat
 * Valenciana, actualizado a diario), filtra los registros de Peñíscola
 * y genera data/TURISMO/viviendas.json con los agregados que usa el
 * dashboard.
 *
 * Fuente:
 *   Conselleria d'Innovació, Indústria, Comerç i Turisme - Generalitat Valenciana
 *   Conjunto de datos: "Datos de turismo sobre viviendas de uso turístico
 *   en la Comunitat Valenciana"
 *   URL del recurso CSV (descarga directa, actualizado diariamente):
 *   https://dadesobertes.gva.es/dataset/758f8f8e-c5af-4622-b268-a6c591710a51/resource/b1bdc28e-9813-422a-ab7a-63c21290493d
 *   Licencia: CC BY 4.0
 *
 * Uso:  node procesar_viviendas.js
 */
const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://dadesobertes.gva.es/dataset/758f8f8e-c5af-4622-b268-a6c591710a51/resource/b1bdc28e-9813-422a-ab7a-63c21290493d/download/lista-de-viviendas-turisticas.csv';
const OUT_DIR = path.join(__dirname, 'data', 'TURISMO');
const OUT_FILE = path.join(OUT_DIR, 'viviendas.json');
const MUNICIPIO_PEN_REGEX = /pe[ñn][íi]scola/i;

function parseCsvLine(line) {
  // CSV simple separado por ';' sin comillas (formato GVA). Si en algún
  // futuro meten comillas o ; dentro de un campo, esto falla; añadimos
  // un fallback básico.
  if (!line.includes('"')) return line.split(';');
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ';' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseFechaAlta(s) {
  // formato dd/MM/yyyy → ISO yyyy-MM-dd
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const inicio = Date.now();
  console.log('[viviendas] Descargando CSV de la GVA…');
  const r = await fetch(CSV_URL);
  if (!r.ok) throw new Error(`GVA HTTP ${r.status}`);
  const txt = await r.text();
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const total = lines.length - 1;
  console.log(`[viviendas] Filas en el CSV: ${total}`);

  // Filtrar Peñíscola por la columna municipio
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const muni = cols[idx.municipio] || '';
    if (!MUNICIPIO_PEN_REGEX.test(muni)) continue;
    const plazas = parseInt(cols[idx.plazas_totales], 10) || 0;
    const dorm = parseInt(cols[idx.dormit_totales], 10) || 0;
    const habdoble = parseInt(cols[idx.habdoble], 10) || 0;
    const habindi = parseInt(cols[idx.habindi], 10) || 0;
    const sup = parseFloat((cols[idx.superficie] || '').replace(',', '.')) || 0;
    rows.push({
      signatura: cols[idx.signatura] || null,
      nombre: cols[idx.nombre] || null,
      direccion: cols[idx.direccion] || null,
      cp: cols[idx.cp] || null,
      ref_catastral: cols[idx.ref_catastral] || null,
      web: cols[idx.web] || null,
      plazas,
      dormitorios: dorm,
      habdoble,
      habindi,
      estudio: (cols[idx.estudio] || '').toUpperCase() === 'S',
      rural: (cols[idx.rural] || '').toUpperCase() === 'S',
      superficie_m2: sup,
      fecha_alta: parseFechaAlta(cols[idx.fecha_alta]),
    });
  }
  console.log(`[viviendas] Viviendas en Peñíscola: ${rows.length}`);

  // Agregados
  const sumPlazas = rows.reduce((a, r) => a + r.plazas, 0);
  const sumSup = rows.reduce((a, r) => a + r.superficie_m2, 0);
  const sumDorm = rows.reduce((a, r) => a + r.dormitorios, 0);
  const estudios = rows.filter((r) => r.estudio).length;
  const rurales = rows.filter((r) => r.rural).length;

  // Altas por año
  const altasPorAnyo = {};
  rows.forEach((r) => {
    if (!r.fecha_alta) return;
    const y = r.fecha_alta.slice(0, 4);
    altasPorAnyo[y] = (altasPorAnyo[y] || 0) + 1;
  });

  // Plazas acumuladas por año (cumulativo: viviendas activas que existían en cada año)
  const anyos = Object.keys(altasPorAnyo).sort();
  const plazasAcum = {};
  let acumPlazas = 0;
  let acumViv = 0;
  // Recorremos por año cronológico: para cada año, sumamos plazas de viviendas dadas de alta ese año
  const plazasPorAnyo = {};
  rows.forEach((r) => {
    if (!r.fecha_alta) return;
    const y = r.fecha_alta.slice(0, 4);
    plazasPorAnyo[y] = (plazasPorAnyo[y] || 0) + r.plazas;
  });
  for (const y of anyos) {
    acumPlazas += plazasPorAnyo[y] || 0;
    acumViv += altasPorAnyo[y] || 0;
    plazasAcum[y] = { viviendas: acumViv, plazas: acumPlazas };
  }

  // Distribución por tamaño (nº plazas)
  const buckets = { '1-2': 0, '3-4': 0, '5-6': 0, '7-8': 0, '9+': 0 };
  rows.forEach((r) => {
    const p = r.plazas;
    if (p <= 2) buckets['1-2']++;
    else if (p <= 4) buckets['3-4']++;
    else if (p <= 6) buckets['5-6']++;
    else if (p <= 8) buckets['7-8']++;
    else buckets['9+']++;
  });

  // Top 10 viviendas por plazas
  const top10 = rows.slice().sort((a, b) => b.plazas - a.plazas).slice(0, 10);

  // Por código postal
  const porCp = {};
  rows.forEach((r) => {
    const cp = (r.cp || '').trim() || 'sin CP';
    if (!porCp[cp]) porCp[cp] = { viviendas: 0, plazas: 0 };
    porCp[cp].viviendas++;
    porCp[cp].plazas += r.plazas;
  });

  const out = {
    generadoEn: new Date().toISOString(),
    fuente: {
      organismo: 'Generalitat Valenciana - Conselleria de Innovació, Indústria, Comerç i Turisme',
      dataset: 'Datos de turismo sobre viviendas de uso turístico en la Comunitat Valenciana',
      portal: 'Portal de Datos Abiertos de la GVA (dadesobertes.gva.es)',
      url: CSV_URL,
      licencia: 'CC BY 4.0',
      actualizacion: 'diaria',
    },
    municipio: 'Peñíscola',
    codigo_municipio_ine: '12089',
    resumen: {
      viviendas_totales: rows.length,
      plazas_totales: sumPlazas,
      dormitorios_totales: sumDorm,
      superficie_total_m2: Math.round(sumSup),
      plazas_por_vivienda: rows.length ? +(sumPlazas / rows.length).toFixed(2) : 0,
      superficie_media_m2: rows.length ? Math.round(sumSup / rows.length) : 0,
      pct_estudios: rows.length ? +(100 * estudios / rows.length).toFixed(1) : 0,
      pct_rurales: rows.length ? +(100 * rurales / rows.length).toFixed(1) : 0,
    },
    altasPorAnyo,
    plazasPorAnyo,
    plazasAcum,
    distribucionTamano: buckets,
    porCp,
    top10,
    todas: rows,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[viviendas] Escrito ${path.relative(__dirname, OUT_FILE)} (${rows.length} viviendas, ${sumPlazas} plazas) en ${dur}s`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[viviendas] Error fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { main };
