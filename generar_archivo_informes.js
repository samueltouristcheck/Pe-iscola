/**
 * Genera informes mensuales y los guarda como archivo consultable (registro).
 *
 * Llama al endpoint /api/informe-ia de PRODUCCIÓN (que sí tiene acceso a OpenAI)
 * y guarda cada informe en data/informes_archivo/<ambito>/<YYYY-MM>.json.
 * Estos ficheros se commitean → se despliegan → archivo compartido y persistente.
 *
 * Uso:
 *   node generar_archivo_informes.js camaras            (todos los meses de cámaras)
 *   node generar_archivo_informes.js camaras 2026-06    (solo ese mes, para probar)
 *   node generar_archivo_informes.js manifest           (regenera el índice)
 *
 * Reensambla los mismos `datos` que la web (kpis/comparativa/graficas) leyendo
 * los JSON de data/. De momento implementado: cámaras.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PROD = process.env.INFORME_API || 'https://pe-iscola.onrender.com';
const OUT_BASE = path.join(__dirname, 'data', 'informes_archivo');
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const pad2 = (n) => String(n).padStart(2, '0');
const mesNombre = (m) => MESES[(+m) - 1] || m;
const pct = (a, b) => (a == null || b == null || !b) ? null : ((a - b) / b) * 100;
const periodoLabel = (anio, mes) => (mes ? mesNombre(mes) + ' ' : '') + anio;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }

function compSpec(comp) {
  return { tipo: 'bar', labels: comp.map((c) => c.label), datasets: [
    { label: 'Actual', data: comp.map((c) => c.actual), color: '#2563eb' },
    { label: 'Mes anterior', data: comp.map((c) => c.mesAnterior), color: '#93c5fd' },
    { label: 'Año anterior', data: comp.map((c) => c.anioAnterior), color: '#f59e0b' }
  ] };
}
function insights(data) {
  const ins = {};
  const g = data.graficas.find((x) => x.spec.tipo === 'line' && x.spec.datasets.length && x.spec.labels.length > 2);
  if (g) {
    const lab = g.spec.labels, d = g.spec.datasets[0].data; let mi = -1, ma = -1;
    for (let i = 0; i < d.length; i++) { if (d[i] != null) { if (ma < 0 || d[i] > d[ma]) ma = i; if (mi < 0 || d[i] < d[mi]) mi = i; } }
    if (ma >= 0) { ins.serie = g.titulo; ins.mesPico = { mes: lab[ma], valor: Math.round(d[ma]) }; ins.mesValle = { mes: lab[mi], valor: Math.round(d[mi]) }; }
  }
  if (data.comparativa) { let best = null; data.comparativa.forEach((c) => { if (c.varAnio != null && (best == null || Math.abs(c.varAnio) > Math.abs(best.pct))) best = { metrica: c.label, pct: Math.round(c.varAnio * 10) / 10 }; }); if (best) ins.mayorVariacionInteranual = best; }
  return ins;
}
function toDatos(data) {
  return {
    kpis: data.kpis.map((k) => ({ label: k.label, valor: k.valor, unidad: k.unidad || '', varMes: k.comp && k.comp.varMes != null ? Math.round(k.comp.varMes * 10) / 10 : null, varAnio: k.comp && k.comp.varAnio != null ? Math.round(k.comp.varAnio * 10) / 10 : null })),
    comparativa: data.comparativa,
    insights: insights(data),
    graficas: data.graficas.map((g) => ({ clave: g.key, titulo: g.titulo, labels: g.spec.labels, series: g.spec.datasets.map((d) => ({ nombre: d.label, datos: d.data })) }))
  };
}

/* ===================== CÁMARAS ===================== */
function camMes(cam, anio, mes) {
  const es = (cam.lpr && cam.lpr.entradasSalidasPorMes) || {}; let e = 0, s = 0, f = false;
  Object.keys(es).forEach((k) => { const ok = mes ? (k === anio + '-' + pad2(mes)) : (k.slice(0, 4) === String(anio)); if (ok) { e += es[k].Avance || 0; s += es[k].Retroceso || 0; f = true; } });
  return f ? { entradas: e, salidas: s } : null;
}
function camAforo(cam, anio, mes) {
  const m = cam.multiobjeto || []; let per = 0, vm = 0, vs = 0, f = false;
  m.forEach((r) => { const fe = r.fecha || ''; const ok = mes ? (fe.indexOf(anio + '-' + pad2(mes)) === 0) : (fe.slice(0, 4) === String(anio)); if (ok) { per += (r.personas_avanzar || 0) + (r.personas_retroceso || 0); vm += (r.vehiculos_motor_avanzar || 0) + (r.vehiculos_motor_retroceso || 0); vs += (r.vehiculos_sin_motor_avanzar || 0) + (r.vehiculos_sin_motor_retroceso || 0); f = true; } });
  return f ? { personas: per, vehMotor: vm, vehSinMotor: vs } : null;
}
function buildCamaras(cam, anio, mes) {
  const cur = camMes(cam, anio, mes) || { entradas: null, salidas: null }, prev = String(+anio - 1); let ma = null;
  if (mes) { const pm = (+mes) - 1; ma = pm >= 1 ? camMes(cam, anio, pm) : camMes(cam, prev, 12); }
  const aa = camMes(cam, prev, mes);
  const es = (cam.lpr && cam.lpr.entradasSalidasPorMes) || {};
  const mo = Object.keys(es).filter((k) => k.slice(0, 4) === String(anio)).sort();
  const comp = [
    { label: 'Entradas', actual: cur.entradas, mesAnterior: ma ? ma.entradas : null, anioAnterior: aa ? aa.entradas : null, varMes: pct(cur.entradas, ma && ma.entradas), varAnio: pct(cur.entradas, aa && aa.entradas) },
    { label: 'Salidas', actual: cur.salidas, mesAnterior: ma ? ma.salidas : null, anioAnterior: aa ? aa.salidas : null, varMes: pct(cur.salidas, ma && ma.salidas), varAnio: pct(cur.salidas, aa && aa.salidas) }
  ];
  const graficas = [];
  if (mo.length) {
    graficas.push({ key: 'entradas_salidas_mes', titulo: 'Entradas y salidas por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map((k) => mesNombre(parseInt(k.slice(5), 10))), datasets: [{ label: 'Entradas', data: mo.map((k) => es[k].Avance || 0), color: '#2563eb' }, { label: 'Salidas', data: mo.map((k) => es[k].Retroceso || 0), color: '#f59e0b' }] } });
    graficas.push({ key: 'saldo_mes', titulo: 'Saldo (entradas − salidas) por mes (' + anio + ')', spec: { tipo: 'bar', labels: mo.map((k) => mesNombre(parseInt(k.slice(5), 10))), datasets: [{ label: 'Saldo', data: mo.map((k) => (es[k].Avance || 0) - (es[k].Retroceso || 0)), color: '#16a34a' }] } });
  }
  graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: compSpec(comp) });
  const af = camAforo(cam, anio, mes);
  if (af && (af.personas || af.vehMotor || af.vehSinMotor)) graficas.push({ key: 'aforo', titulo: 'Aforo (paso total de personas y vehículos)', spec: { tipo: 'bar', labels: ['Personas', 'Veh. a motor', 'Veh. sin motor'], datasets: [{ label: 'Pasos', data: [af.personas, af.vehMotor, af.vehSinMotor], color: '#7c3aed' }] } });
  const yby = {}; Object.keys(es).forEach((k) => { const y = k.slice(0, 4); yby[y] = (yby[y] || 0) + (es[k].Avance || 0); }); const ys = Object.keys(yby).sort();
  if (ys.length > 1) graficas.push({ key: 'entradas_anual', titulo: 'Entradas por año', spec: { tipo: 'bar', labels: ys, datasets: [{ label: 'Entradas', data: ys.map((y) => yby[y]), color: '#0ea5e9' }] } });
  const kpis = [
    { label: 'Entradas de vehículos', valor: cur.entradas, comp: comp[0] },
    { label: 'Salidas de vehículos', valor: cur.salidas, comp: comp[1] },
    { label: 'Saldo (entradas − salidas)', valor: (cur.entradas != null && cur.salidas != null) ? cur.entradas - cur.salidas : null }
  ];
  if (af) { kpis.push({ label: 'Personas (aforo)', valor: af.personas }); kpis.push({ label: 'Veh. a motor (aforo)', valor: af.vehMotor }); }
  return { kpis, comparativa: comp, graficas };
}
function mesesCamaras(cam) {
  const set = new Set();
  Object.keys((cam.lpr && cam.lpr.entradasSalidasPorMes) || {}).forEach((k) => { if (/^\d{4}-\d{2}$/.test(k)) set.add(k); });
  (cam.multiobjeto || []).forEach((r) => { if (/^\d{4}-\d{2}$/.test(r.fecha || '')) set.add(r.fecha); });
  return Array.from(set).sort();
}

/* ===================== runner ===================== */
const AMBITOS = {
  camaras: {
    load: () => readJson('data/camaras/todos.json'),
    meses: (d) => mesesCamaras(d),
    build: (d, anio, mes) => buildCamaras(d, anio, mes)
  }
};

async function generarUno(ambito, ym, dataset) {
  const [anio, mes] = ym.split('-').map(Number);
  const spec = AMBITOS[ambito];
  const data = spec.build(dataset, anio, mes);
  const datos = toDatos(data);
  const label = periodoLabel(anio, mes);
  const r = await fetch(`${PROD}/api/informe-ia`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ambito, periodoLabel: label, datos })
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`); }
  const res = await r.json();
  if (res.error) throw new Error(res.error);
  const dir = path.join(OUT_BASE, ambito);
  fs.mkdirSync(dir, { recursive: true });
  // Guardamos el objeto `data` completo (con specs de gráficas y comparativas)
  // para poder re-renderizar el informe en la UI del archivo sin volver a la IA.
  const dataFull = Object.assign({}, data, { periodoLabel: label, anio, mes });
  const registro = { ambito, anio, mes, periodoLabel: label, texto: res.texto, data: dataFull, generadoEl: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, `${ym}.json`), JSON.stringify(registro));
  return { palabras: (res.texto || '').split(/\s+/).length, graficas: data.graficas.length, kpis: data.kpis.length };
}

function construirManifest() {
  const manifest = {};
  if (fs.existsSync(OUT_BASE)) {
    for (const amb of fs.readdirSync(OUT_BASE)) {
      const dir = path.join(OUT_BASE, amb);
      if (!fs.statSync(dir).isDirectory()) continue;
      const items = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { anio: j.anio, mes: j.mes, ym: f.replace('.json', ''), periodoLabel: j.periodoLabel, generadoEl: j.generadoEl };
      }).sort((a, b) => a.ym.localeCompare(b.ym));
      manifest[amb] = items;
    }
  }
  fs.mkdirSync(OUT_BASE, { recursive: true });
  fs.writeFileSync(path.join(OUT_BASE, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const total = Object.values(manifest).reduce((a, x) => a + x.length, 0);
  console.log(`📇 Manifest: ${total} informes en ${Object.keys(manifest).length} ámbitos.`);
}

async function main() {
  const ambito = process.argv[2];
  const soloMes = process.argv[3];
  if (ambito === 'manifest') { construirManifest(); return; }
  if (!AMBITOS[ambito]) { console.error('Ámbito no implementado:', ambito, '(disponible:', Object.keys(AMBITOS).join(', ') + ')'); process.exit(1); }
  const spec = AMBITOS[ambito];
  const dataset = spec.load();
  let meses = spec.meses(dataset);
  if (soloMes) meses = meses.filter((m) => m === soloMes);
  console.log(`🗂️  ${ambito}: ${meses.length} meses a generar → ${PROD}`);
  let ok = 0, fail = 0;
  for (const ym of meses) {
    try {
      const info = await generarUno(ambito, ym, dataset);
      ok++;
      console.log(`  ✅ ${ym} — ${info.palabras} palabras, ${info.graficas} gráficas, ${info.kpis} KPIs`);
    } catch (e) {
      fail++;
      console.error(`  ❌ ${ym} — ${e.message}`);
    }
    await sleep(1500);
  }
  construirManifest();
  console.log(`\nHecho: ${ok} ok, ${fail} fallos.`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildCamaras, toDatos, construirManifest };
