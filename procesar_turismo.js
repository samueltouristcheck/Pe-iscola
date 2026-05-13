/**
 * Descarga datos de turismo de Peñíscola desde la API JSON del INE
 * (https://servicios.ine.es/wstempus/js/ES/...) y genera data/TURISMO/todos.json.
 *
 * Series cubiertas (56 totales):
 *   - Hoteles (EOH, tablas 2078, 2077): viajeros, pernoctaciones, estancia media
 *   - Apartamentos (EOAP, tabla 2082): viajeros, pernoctaciones (Peñíscola sin datos por secreto)
 *   - Campings (EOAC, tablas 2084, 2085): viajeros, pernoctaciones, establecimientos,
 *       plazas, parcelas, ocupación, personal
 *   - Padrón (tabla 2865): población total, hombres, mujeres (anual)
 *   - Movilidad / TMOV experimental: turistas extranjeros estimados con datos
 *       agregados de operadoras móviles, total + 32 países/continentes
 *
 * Uso:
 *   node procesar_turismo.js              (todas las series, histórico completo)
 *   node procesar_turismo.js --nult 24    (solo últimos N periodos)
 */
const fs = require('fs');
const path = require('path');

const BASE_API = 'https://servicios.ine.es/wstempus/js/ES';
const OUT_DIR = path.join(__dirname, 'data', 'TURISMO');
const OUT_FILE = path.join(OUT_DIR, 'todos.json');

// COD INE -> { categoria, metrica, residencia, unidad }
const SERIES = {
  // ====== HOTELES (EOH) ======
  EOT12498: { categoria: 'hoteles', metrica: 'viajeros',        residencia: 'espana',     unidad: 'personas' },
  EOT12499: { categoria: 'hoteles', metrica: 'viajeros',        residencia: 'extranjero', unidad: 'personas' },
  EOT12500: { categoria: 'hoteles', metrica: 'pernoctaciones',  residencia: 'espana',     unidad: 'noches'   },
  EOT12501: { categoria: 'hoteles', metrica: 'pernoctaciones',  residencia: 'extranjero', unidad: 'noches'   },
  EOT12317: { categoria: 'hoteles', metrica: 'estancia_media',  residencia: 'total',      unidad: 'dias'     },
  // ====== APARTAMENTOS (EOAP) — series existen pero el INE no publica valores ======
  EOT44530: { categoria: 'apartamentos', metrica: 'viajeros',       residencia: 'espana',     unidad: 'personas' },
  EOT44529: { categoria: 'apartamentos', metrica: 'viajeros',       residencia: 'extranjero', unidad: 'personas' },
  EOT44654: { categoria: 'apartamentos', metrica: 'pernoctaciones', residencia: 'espana',     unidad: 'noches'   },
  EOT44653: { categoria: 'apartamentos', metrica: 'pernoctaciones', residencia: 'extranjero', unidad: 'noches'   },
  // ====== CAMPINGS — viajeros y pernoctaciones (EOAC tabla 2084) ======
  EOT7755:  { categoria: 'campings', metrica: 'viajeros',       residencia: 'espana',     unidad: 'personas' },
  EOT7756:  { categoria: 'campings', metrica: 'viajeros',       residencia: 'extranjero', unidad: 'personas' },
  EOT7757:  { categoria: 'campings', metrica: 'pernoctaciones', residencia: 'espana',     unidad: 'noches'   },
  EOT7758:  { categoria: 'campings', metrica: 'pernoctaciones', residencia: 'extranjero', unidad: 'noches'   },
  // ====== CAMPINGS — oferta y ocupación (EOAC tabla 2085) ======
  EOT8172:  { categoria: 'campings', metrica: 'establecimientos',      residencia: 'total', unidad: 'unidades' },
  EOT8173:  { categoria: 'campings', metrica: 'plazas',                residencia: 'total', unidad: 'plazas' },
  EOT8174:  { categoria: 'campings', metrica: 'parcelas',              residencia: 'total', unidad: 'parcelas' },
  EOT8175:  { categoria: 'campings', metrica: 'parcelas_ocupadas',     residencia: 'total', unidad: 'parcelas' },
  EOT8176:  { categoria: 'campings', metrica: 'grado_ocupacion',       residencia: 'total', unidad: 'porcentaje' },
  EOT8177:  { categoria: 'campings', metrica: 'grado_ocupacion_finde', residencia: 'total', unidad: 'porcentaje' },
  EOT8178:  { categoria: 'campings', metrica: 'personal_empleado',     residencia: 'total', unidad: 'personas' },
  // ====== PADRÓN (Castellón, tabla 2865) — anual ======
  DPOP5698: { categoria: 'padron', metrica: 'poblacion', residencia: 'total',   unidad: 'personas' },
  DPOP5699: { categoria: 'padron', metrica: 'poblacion', residencia: 'hombres', unidad: 'personas' },
  DPOP5700: { categoria: 'padron', metrica: 'poblacion', residencia: 'mujeres', unidad: 'personas' },
  // ====== MOVILIDAD / TMOV — turistas extranjeros estimados (móvil), mensual ======
  TMOV176531: { categoria: 'movilidad', metrica: 'turistas', residencia: 'total',           unidad: 'personas' },
  TMOV176532: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Francia',         unidad: 'personas' },
  TMOV176533: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Italia',          unidad: 'personas' },
  TMOV176534: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Portugal',        unidad: 'personas' },
  TMOV176535: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Andorra',         unidad: 'personas' },
  TMOV176536: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Reino Unido',     unidad: 'personas' },
  TMOV176537: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Alemania',        unidad: 'personas' },
  TMOV141800: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Europa',          unidad: 'personas' },
  TMOV141801: { categoria: 'movilidad', metrica: 'turistas', residencia: 'UE27 sin España', unidad: 'personas' },
  TMOV141802: { categoria: 'movilidad', metrica: 'turistas', residencia: 'África',          unidad: 'personas' },
  TMOV141803: { categoria: 'movilidad', metrica: 'turistas', residencia: 'América',         unidad: 'personas' },
  TMOV141804: { categoria: 'movilidad', metrica: 'turistas', residencia: 'América del Norte', unidad: 'personas' },
  TMOV141805: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Sudamérica',      unidad: 'personas' },
  TMOV141806: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Asia',            unidad: 'personas' },
  TMOV141807: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Austria',         unidad: 'personas' },
  TMOV141808: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Bélgica',         unidad: 'personas' },
  TMOV141809: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Bulgaria',        unidad: 'personas' },
  TMOV141810: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Dinamarca',       unidad: 'personas' },
  TMOV141811: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Hungría',         unidad: 'personas' },
  TMOV141812: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Irlanda',         unidad: 'personas' },
  TMOV141813: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Luxemburgo',      unidad: 'personas' },
  TMOV141814: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Noruega',         unidad: 'personas' },
  TMOV141815: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Países Bajos',    unidad: 'personas' },
  TMOV141816: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Polonia',         unidad: 'personas' },
  TMOV141817: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Rumanía',         unidad: 'personas' },
  TMOV141818: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Suecia',          unidad: 'personas' },
  TMOV141819: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Suiza',           unidad: 'personas' },
  TMOV141820: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Ucrania',         unidad: 'personas' },
  TMOV141821: { categoria: 'movilidad', metrica: 'turistas', residencia: 'República Checa', unidad: 'personas' },
  TMOV141822: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Rusia',           unidad: 'personas' },
  TMOV141823: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Argelia',         unidad: 'personas' },
  TMOV141824: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Marruecos',       unidad: 'personas' },
  TMOV141825: { categoria: 'movilidad', metrica: 'turistas', residencia: 'Estados Unidos',  unidad: 'personas' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const nultIdx = args.indexOf('--nult');
  const nult = nultIdx >= 0 ? parseInt(args[nultIdx + 1], 10) : 0;
  return { nult: nult > 0 ? nult : 0 };
}

async function fetchSerie(cod, nult) {
  const url = `${BASE_API}/DATOS_SERIE/${cod}?nult=${nult}`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`INE ${cod}: HTTP ${r.status}`);
  return r.json();
}

function periodoToFecha(anyo, fkPeriodo) {
  if (fkPeriodo >= 1 && fkPeriodo <= 12) return `${anyo}-${String(fkPeriodo).padStart(2, '0')}`;
  if (fkPeriodo >= 41 && fkPeriodo <= 44) return `${anyo}-Q${fkPeriodo - 40}`;
  return `${anyo}`;
}

function aplanarSerie(payload) {
  const data = Array.isArray(payload.Data) ? payload.Data : [];
  return data
    .filter((d) => d.Valor != null && !isNaN(d.Valor))
    .map((d) => ({
      fecha: periodoToFecha(d.Anyo, d.FK_Periodo),
      anyo: d.Anyo,
      mes: d.FK_Periodo >= 1 && d.FK_Periodo <= 12 ? d.FK_Periodo : null,
      valor: Number(d.Valor),
      secreto: d.Secreto === true,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function sumarPorMes(lista) {
  const m = {};
  lista.forEach((s) => s.data.forEach((d) => { m[d.fecha] = (m[d.fecha] || 0) + d.valor; }));
  return m;
}

function totalAnyo(mapa, anyo) {
  return Object.entries(mapa)
    .filter(([f]) => f.startsWith(String(anyo)))
    .reduce((acc, [, v]) => acc + v, 0);
}

function calcularResumenCategoria(series, cat) {
  const out = {};
  const viaj = series.filter((s) => s.metrica === 'viajeros');
  const pern = series.filter((s) => s.metrica === 'pernoctaciones');
  if (viaj.length || pern.length) {
    const viajeros = sumarPorMes(viaj);
    const pernoctaciones = sumarPorMes(pern);
    const fechas = Object.keys(viajeros).length ? Object.keys(viajeros) : Object.keys(pernoctaciones);
    const ultima = fechas.sort()[fechas.length - 1] || null;
    const anyoActual = ultima ? +ultima.slice(0, 4) : null;
    out.ultimoMes = ultima;
    out.viajerosUltimo = ultima ? viajeros[ultima] || 0 : null;
    out.pernoctacionesUltimo = ultima ? pernoctaciones[ultima] || 0 : null;
    out.totalViajerosAnyo = anyoActual ? totalAnyo(viajeros, anyoActual) : null;
    out.totalPernoctacionesAnyo = anyoActual ? totalAnyo(pernoctaciones, anyoActual) : null;
    out.totalViajerosAnyoAnterior = anyoActual ? totalAnyo(viajeros, anyoActual - 1) : null;
    out.totalPernoctacionesAnyoAnterior = anyoActual ? totalAnyo(pernoctaciones, anyoActual - 1) : null;
  }
  if (cat === 'movilidad') {
    const totalTuristas = series.filter((s) => s.metrica === 'turistas' && s.residencia === 'total');
    if (totalTuristas.length) {
      const mapa = sumarPorMes(totalTuristas);
      const fechas = Object.keys(mapa).sort();
      const ultima = fechas[fechas.length - 1] || null;
      const anyoActual = ultima ? +ultima.slice(0, 4) : null;
      out.ultimoMes = ultima;
      out.turistasUltimo = ultima ? mapa[ultima] : null;
      out.totalTuristasAnyo = anyoActual ? totalAnyo(mapa, anyoActual) : null;
      out.totalTuristasAnyoAnterior = anyoActual ? totalAnyo(mapa, anyoActual - 1) : null;
      // Top países (suma 12 últimos meses)
      const ultimo12 = fechas.slice(-12);
      const top = series
        .filter((s) => s.metrica === 'turistas' && s.residencia !== 'total' && !['Europa', 'UE27 sin España', 'América', 'África', 'Asia', 'América del Norte', 'Sudamérica'].includes(s.residencia))
        .map((s) => ({ pais: s.residencia, total: s.data.filter((d) => ultimo12.includes(d.fecha)).reduce((a, b) => a + b.valor, 0) }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      out.topPaises = top;
    }
  }
  if (cat === 'campings') {
    const grado = series.find((s) => s.metrica === 'grado_ocupacion');
    const plazas = series.find((s) => s.metrica === 'plazas');
    const est = series.find((s) => s.metrica === 'establecimientos');
    if (grado?.data.length) out.ultimoGradoOcupacion = grado.data[grado.data.length - 1].valor;
    if (plazas?.data.length) out.ultimasPlazas = plazas.data[plazas.data.length - 1].valor;
    if (est?.data.length) out.ultimosEstablecimientos = est.data[est.data.length - 1].valor;
  }
  return out;
}

function calcularResumen(seriesPorCategoria) {
  const resumen = {};
  for (const [cat, series] of Object.entries(seriesPorCategoria)) {
    resumen[cat] = calcularResumenCategoria(series, cat);
  }
  const padron = (seriesPorCategoria.padron || []).find((s) => s.residencia === 'total');
  if (padron && padron.data.length) {
    const last = padron.data[padron.data.length - 1];
    resumen.padron = { ultimoAnyo: last.anyo, poblacion: last.valor };
  }
  // Presión turística (turistas extranjeros / habitantes × 1000)
  if (resumen.padron?.poblacion && resumen.movilidad?.turistasUltimo) {
    resumen.presionTuristica = {
      mes: resumen.movilidad.ultimoMes,
      turistas: resumen.movilidad.turistasUltimo,
      habitantes: resumen.padron.poblacion,
      ratio_por_1000_habitantes: Math.round((resumen.movilidad.turistasUltimo / resumen.padron.poblacion) * 1000),
    };
  }
  return resumen;
}

function organizarPorCategoria(seriesDescargadas) {
  const out = { hoteles: [], apartamentos: [], campings: [], padron: [], movilidad: [] };
  for (const s of seriesDescargadas) {
    const meta = SERIES[s.cod];
    if (!meta) continue;
    if (!out[meta.categoria]) out[meta.categoria] = [];
    out[meta.categoria].push({
      cod: s.cod,
      metrica: meta.metrica,
      residencia: meta.residencia,
      unidad: meta.unidad,
      data: s.data,
    });
  }
  return out;
}

async function main() {
  const { nult } = parseArgs();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const inicio = Date.now();
  const codigos = Object.keys(SERIES);
  console.log(`[turismo] Descargando ${codigos.length} series del INE${nult ? ` (últimos ${nult} periodos)` : ' (histórico completo)'}...`);

  const resultados = [];
  const errores = [];

  // Bloques de 5 en paralelo para no saturar al INE
  for (let i = 0; i < codigos.length; i += 5) {
    const batch = codigos.slice(i, i + 5);
    const res = await Promise.allSettled(batch.map((cod) => fetchSerie(cod, nult).then((p) => ({ cod, payload: p }))));
    res.forEach((r, idx) => {
      const cod = batch[idx];
      const meta = SERIES[cod];
      if (r.status === 'fulfilled') {
        const data = aplanarSerie(r.value.payload);
        resultados.push({ cod, nombre: r.value.payload.Nombre, data });
        process.stdout.write(`  ✓ ${cod} (${meta.categoria}/${meta.metrica}/${meta.residencia}) — ${data.length}\n`);
      } else {
        errores.push({ cod, error: r.reason?.message || String(r.reason) });
        process.stdout.write(`  ✗ ${cod}: ${r.reason?.message || r.reason}\n`);
      }
    });
  }

  const porCategoria = organizarPorCategoria(resultados);
  const resumen = calcularResumen(porCategoria);

  const out = {
    generadoEn: new Date().toISOString(),
    fuente: 'INE - Instituto Nacional de Estadística (https://www.ine.es)',
    municipio: 'Peñíscola',
    codigoMunicipio: '12089',
    seriesTotales: codigos.length,
    seriesOk: resultados.length,
    errores,
    resumen,
    series: porCategoria,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  const dur = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[turismo] Escrito ${path.relative(__dirname, OUT_FILE)} (${resultados.length}/${codigos.length} OK) en ${dur}s`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[turismo] Error fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { main, SERIES };
