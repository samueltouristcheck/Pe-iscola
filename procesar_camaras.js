/**
 * Procesa datos de cámaras LPR y multiobjeto.
 * LPR: agrega por fecha/cámara (sin guardar todos los registros) para evitar OOM.
 * Multiobjeto: guarda registros diarios (pocos).
 *
 * Genera: data/camaras/todos.json { lpr: { agregados: [], byFecha: {}, byCamara: {} }, multiobjeto: [] }
 *
 * Uso: node procesar_camaras.js
 * O: npm run preparar (residuos + cámaras)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE = path.join(__dirname, 'data', 'camaras');
const LPR_DIR = path.join(BASE, 'Trafico_camaras', 'CSV');
const MULTIOBJ_DIR = path.join(BASE, 'Camaras_Multiobjeto', 'CSV');
const ENTRADA_DIR = path.join(BASE, 'entrada');
const SALIDA_PATH = path.join(BASE, 'todos.json');

// Ventana deduplicación: misma matrícula en distintas cámaras en <10 min = 1
const DEDUP_WINDOW_MIN = 10;
const BUCKET_MS = DEDUP_WINDOW_MIN * 60 * 1000;

function parseHora(horaStr) {
  const m = horaStr && horaStr.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// --- LPR: procesar línea a línea, agregar + deduplicar por matrícula/10min
function procesarLPRStream(filePath, setsDedup, setsDedupDia) {
  return new Promise((resolve, reject) => {
    const byKey = {};
    const byKeyDir = {};
    const byFecha = {};
    const byCamara = {};
    const byNacionalidad = {};
    const byColor = {};
    const byHora = {};
    const setsDedupUse = setsDedup || {};
    const setsDedupDiaUse = setsDedupDia || {};
    let lineNum = 0;
    let idx = null;
    let cols = [];

    const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    rl.on('line', (line) => {
      lineNum++;
      if (lineNum <= 6) {
        if (lineNum === 6) {
          cols = line.split(';').map(h => h.trim().replace(/^["']|["']$/g, ''));
          idx = {
            matricula: cols.findIndex(c => /número de matrícula|matrícula|matricula/i.test(c)),
            hora: cols.findIndex(c => /^hora$/i.test(c)),
            camara: cols.findIndex(c => /cámara|camara/i.test(c)),
            pais: cols.findIndex(c => /país|pais|región|region/i.test(c)),
            tipo: cols.findIndex(c => /tipo de vehículo|tipo/i.test(c)),
            color: cols.findIndex(c => /^color$/i.test(c)),
            direccion: cols.findIndex(c => /dirección de conducción|direccion de conduccion/i.test(c))
          };
        }
        return;
      }
      const parts = line.split(';').map(p => p.trim().replace(/^["']|["']$/g, '').replace(/^="|"$/g, ''));
      const matriculaRaw = (idx.matricula >= 0 ? parts[idx.matricula] : '').trim() || '';
      const hora = idx.hora >= 0 ? parts[idx.hora] : '';
      const camara = (idx.camara >= 0 ? parts[idx.camara] : '').trim() || 'Sin cámara';
      let direccion = (idx.direccion >= 0 ? parts[idx.direccion] : '').trim() || '';
      if (direccion && !/avance|invertir/i.test(direccion)) direccion = 'Otro';
      else if (/avance/i.test(direccion)) direccion = 'Avance';
      else if (/invertir/i.test(direccion)) direccion = 'Retroceso';
      const nacionalidad = (idx.pais >= 0 ? parts[idx.pais] : '').trim() || 'Desconocido';
      const color = (idx.color >= 0 ? parts[idx.color] : '').trim() || 'Desconocido';
      let fecha = '';
      const ts = parseHora(hora);
      if (hora && /^\d{4}\/\d{2}\/\d{2}/.test(hora)) {
        const m = hora.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (m) fecha = `${m[1]}-${m[2]}`;
      }
      if (!fecha) return;
      const key = `${fecha}|${camara}`;
      byKey[key] = (byKey[key] || 0) + 1;
      byFecha[fecha] = (byFecha[fecha] || 0) + 1;
      byCamara[camara] = (byCamara[camara] || 0) + 1;
      if (direccion) {
        const keyDir = `${fecha}|${camara}|${direccion}`;
        byKeyDir[keyDir] = (byKeyDir[keyDir] || 0) + 1;
      }
      if (nacionalidad && nacionalidad !== '--') byNacionalidad[nacionalidad] = (byNacionalidad[nacionalidad] || 0) + 1;
      if (color && color !== '--') byColor[color] = (byColor[color] || 0) + 1;

      if (direccion && ts) {
        const hour = new Date(ts).getHours();
        if (!byHora[hour]) byHora[hour] = { Avance: 0, Retroceso: 0, Otro: 0 };
        byHora[hour][direccion] = (byHora[hour][direccion] || 0) + 1;
      }
      if (direccion && ts) {
        const bucket = Math.floor(ts / BUCKET_MS);
        const matricula = (matriculaRaw && !/unknown|desconocido/i.test(matriculaRaw)) ? matriculaRaw : `_u_${lineNum}_${bucket}`;
        const dedupKey = `${matricula}|${direccion}|${bucket}`;
        const kFechaDir = `${fecha}|${direccion}`;
        if (!setsDedupUse[kFechaDir]) setsDedupUse[kFechaDir] = new Set();
        setsDedupUse[kFechaDir].add(dedupKey);
        const mDia = hora.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (mDia) {
          const kDia = `${fecha}-${String(mDia[3]).padStart(2, '0')}|${direccion}`;
          if (!setsDedupDiaUse[kDia]) setsDedupDiaUse[kDia] = new Set();
          setsDedupDiaUse[kDia].add(dedupKey);
        }
      }
    });
    rl.on('close', () => {
      const agregados = Object.entries(byKey).map(([k, c]) => {
        const [fecha, camara] = k.split('|');
        return { fecha, camara, count: c };
      });
      const agregadosPorDireccion = Object.entries(byKeyDir).map(([k, c]) => {
        const [fecha, camara, direccion] = k.split('|');
        return { fecha, camara, direccion, count: c };
      });
      resolve({
        agregados,
        agregadosPorDireccion,
        byFecha,
        byCamara,
        byNacionalidad,
        byColor,
        byHora,
        total: Object.values(byKey).reduce((a, c) => a + c, 0)
      });
    });
    rl.on('error', reject);
  });
}

// --- Multiobjeto: CSV pequeño, leer todo
function procesarMultiobjeto(filePath, nombreCamara) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 17) return [];
  const rows = [];
  for (let i = 16; i < lines.length; i++) {
    const parts = lines[i].split(';').map(p => p.trim());
    const horaRaw = parts[1] || '';
    const m = horaRaw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (!m) continue;
    const fecha = `${m[1]}-${m[2]}`;
    const dia = parseInt(m[3], 10) || null;
    const num = (v) => (v === '' || v === undefined) ? 0 : parseInt(String(v).replace(/\D/g, ''), 10) || 0;
    rows.push({
      fuente: 'multiobjeto',
      camara: nombreCamara,
      fecha,
      dia,
      personas_avanzar: num(parts[2]),
      personas_retroceso: num(parts[5]),
      vehiculos_motor_avanzar: num(parts[8]),
      vehiculos_motor_retroceso: num(parts[11]),
      vehiculos_sin_motor_avanzar: num(parts[14]),
      vehiculos_sin_motor_retroceso: num(parts[17])
    });
  }
  return rows;
}

function listarArchivos(dir, ext, recursive = false) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory() && recursive) {
      files.push(...listarArchivos(full, ext, true));
    } else if (it.isFile() && ext.test(it.name)) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  let lprResult = {
    agregados: [],
    agregadosPorDireccion: [],
    byFecha: {},
    byCamara: {},
    byNacionalidad: {},
    byColor: {},
    total: 0
  };
  let multiobjeto = [];

  // 1. LPR - streaming, agregar (sets compartidos para deduplicación entre archivos)
  const setsDedup = {};
  const setsDedupDia = {};
  if (fs.existsSync(LPR_DIR)) {
    const lprFiles = listarArchivos(LPR_DIR, /\.csv$/i);
    const keyMapDir = {};
    const byHoraMerged = {};
    for (const fp of lprFiles) {
      try {
        const res = await procesarLPRStream(fp, setsDedup, setsDedupDia);
        if (res.total) {
          const keyMap = {};
          lprResult.agregados.forEach(a => { keyMap[`${a.fecha}|${a.camara}`] = a; });
          res.agregados.forEach(a => {
            const key = `${a.fecha}|${a.camara}`;
            if (keyMap[key]) keyMap[key].count += a.count;
            else { keyMap[key] = { ...a }; lprResult.agregados.push(keyMap[key]); }
          });
          (res.agregadosPorDireccion || []).forEach(a => {
            const k = `${a.fecha}|${a.camara}|${a.direccion}`;
            if (keyMapDir[k]) keyMapDir[k].count += a.count;
            else { keyMapDir[k] = { ...a }; lprResult.agregadosPorDireccion.push(keyMapDir[k]); }
          });
          Object.entries(res.byFecha || {}).forEach(([f, c]) => { lprResult.byFecha[f] = (lprResult.byFecha[f] || 0) + c; });
          Object.entries(res.byCamara || {}).forEach(([c, n]) => { lprResult.byCamara[c] = (lprResult.byCamara[c] || 0) + n; });
          Object.entries(res.byNacionalidad || {}).forEach(([n, c]) => { lprResult.byNacionalidad[n] = (lprResult.byNacionalidad[n] || 0) + c; });
          Object.entries(res.byColor || {}).forEach(([col, c]) => { lprResult.byColor[col] = (lprResult.byColor[col] || 0) + c; });
          Object.entries(res.byHora || {}).forEach(([h, obj]) => {
            if (!byHoraMerged[h]) byHoraMerged[h] = { Avance: 0, Retroceso: 0, Otro: 0 };
            ['Avance', 'Retroceso', 'Otro'].forEach((d) => { byHoraMerged[h][d] = (byHoraMerged[h][d] || 0) + (obj[d] || 0); });
          });
          lprResult.total += res.total;
        }
        console.log('LPR:', path.basename(fp), '->', res.total, 'registros');
      } catch (e) {
        console.error('Error LPR', path.basename(fp), ':', e.message);
      }
    }
    // Calcular entradas/salidas deduplicadas desde los sets finales
    Object.entries(setsDedup).forEach(([k, set]) => {
      const [fecha, dir] = k.split('|');
      if (!lprResult.entradasSalidasPorMes) lprResult.entradasSalidasPorMes = {};
      if (!lprResult.entradasSalidasPorMes[fecha]) lprResult.entradasSalidasPorMes[fecha] = { Avance: 0, Retroceso: 0 };
      lprResult.entradasSalidasPorMes[fecha][dir] = set.size;
    });
    Object.entries(setsDedupDia).forEach(([k, set]) => {
      const [fechaDia, dir] = k.split('|');
      if (!lprResult.entradasSalidasPorDia) lprResult.entradasSalidasPorDia = {};
      if (!lprResult.entradasSalidasPorDia[fechaDia]) lprResult.entradasSalidasPorDia[fechaDia] = { Avance: 0, Retroceso: 0 };
      lprResult.entradasSalidasPorDia[fechaDia][dir] = set.size;
    });
    lprResult.entradasSalidasPorHora = byHoraMerged;
  }

  // 2. Multiobjeto
  const byCamaraMultiobjeto = {};
  if (fs.existsSync(MULTIOBJ_DIR)) {
    const multiFiles = listarArchivos(MULTIOBJ_DIR, /\.csv$/i, true);
    for (const fp of multiFiles) {
      try {
        const rel = path.relative(MULTIOBJ_DIR, path.dirname(fp));
        const nombreCamara = rel.split(path.sep)[0] || path.basename(path.dirname(fp));
        const rows = procesarMultiobjeto(fp, nombreCamara);
        multiobjeto = multiobjeto.concat(rows);
        rows.forEach(r => { byCamaraMultiobjeto[r.camara] = (byCamaraMultiobjeto[r.camara] || 0) + 1; });
        console.log('Multiobjeto:', path.basename(fp), '(' + nombreCamara + ') ->', rows.length, 'registros');
      } catch (e) {
        console.error('Error Multiobjeto', path.basename(fp), ':', e.message);
      }
    }
  }

  // 3. Entrada genérica (opcional)
  if (fs.existsSync(ENTRADA_DIR)) {
    const XLSX = require('xlsx');
    const genFiles = fs.readdirSync(ENTRADA_DIR)
      .filter(f => /\.(csv|xlsx|xls)$/i.test(f))
      .map(f => path.join(ENTRADA_DIR, f));
    for (const fp of genFiles) {
      try {
        const ext = path.extname(fp).toLowerCase();
        if (ext === '.csv') {
          const txt = fs.readFileSync(fp, 'utf8');
          const lines = txt.split(/\r?\n/).filter(l => l.trim());
          if (lines.length < 2) continue;
          const header = lines[0].split(/[,;\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''));
            const row = {};
            header.forEach((h, j) => { row[h] = parts[j] || ''; });
            const obj = { fuente: 'entrada', camara: row.camara || row.Cámara, fecha: row.fecha || row.Fecha };
            if (obj.camara || obj.fecha) multiobjeto.push(obj);
          }
        }
        console.log('Entrada:', path.basename(fp));
      } catch (e) {
        console.error('Error entrada', path.basename(fp), ':', e.message);
      }
    }
  }

  // Cargar coordenadas y construir camarasMapa (LPR + multiobjeto)
  const coordsPath = path.join(BASE, 'camaras_coordenadas.json');
  const CENTRO_PENISCOLA = { lat: 40.37, lng: 0.4 };
  let coords = {};
  if (fs.existsSync(coordsPath)) {
    try {
      coords = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
    } catch (e) {
      console.warn('Coordenadas cámaras:', e.message);
    }
  }
  const todasCamaras = [...new Set([
    ...Object.keys(lprResult.byCamara || {}),
    ...Object.keys(byCamaraMultiobjeto)
  ])];
  const camarasMapa = [];
  todasCamaras.forEach((nombre, i) => {
    const c = coords[nombre] || coords[nombre.replace(/^\d+\s*-\s*/, '')];
    let lat = (c && c.lat != null) ? c.lat : null;
    let lng = (c && c.lng != null) ? c.lng : null;
    if (lat == null || lng == null) {
      const offset = 0.002 * (i % 5) - 0.004;
      lat = CENTRO_PENISCOLA.lat + offset;
      lng = CENTRO_PENISCOLA.lng + offset * 0.5;
    }
    const countLPR = lprResult.byCamara[nombre] || 0;
    const countMulti = byCamaraMultiobjeto[nombre] || 0;
    camarasMapa.push({ nombre, lat, lng, count: countLPR + countMulti, fuente: countLPR ? (countMulti ? 'lpr+multiobjeto' : 'lpr') : 'multiobjeto' });
  });

  const resultado = {
    lpr: lprResult,
    camarasMapa: camarasMapa,
    multiobjeto
  };
  fs.mkdirSync(path.dirname(SALIDA_PATH), { recursive: true });
  fs.writeFileSync(SALIDA_PATH, JSON.stringify(resultado, null, 2), 'utf8');
  console.log('\nGuardado:', SALIDA_PATH);
  console.log('  LPR:', lprResult.total, 'matrículas (agregados:', lprResult.agregados.length, ', direccion:', lprResult.agregadosPorDireccion.length, ')');
  console.log('  Cámaras en mapa:', camarasMapa.length);
  console.log('  Multiobjeto:', multiobjeto.length, 'registros');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
