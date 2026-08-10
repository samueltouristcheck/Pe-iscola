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
const SIT_DATA = (function () { try { return readJson('data/camaras/sit_camaras.json'); } catch (e) { return null; } })();

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
  const sitMes = (SIT_DATA && SIT_DATA.datos) ? SIT_DATA.datos[anio + '-' + pad2(mes)] : null;
  if (mes && sitMes) {
    const franjasSet = {}, franjasOrden = [];
    (sitMes.puntos || []).forEach((pt) => { if (pt.tipo === 'aforo' && pt.franjas) pt.franjas.forEach((f) => { if (!(f.etq in franjasSet)) franjasOrden.push(f.etq); franjasSet[f.etq] = (franjasSet[f.etq] || 0) + f.entrada + f.salida; }); });
    if (franjasOrden.length) graficas.push({ key: 'peatones_franja', titulo: 'Peatones por franja horaria (aforo, ' + sitMes.periodoLabel + ')', spec: { tipo: 'bar', labels: franjasOrden.map((e) => e.replace(' h', '').replace(':00', 'h')), datasets: [{ label: 'Peatones (paso total)', data: franjasOrden.map((k) => franjasSet[k]), color: '#0ea5e9' }] } });
    const lprPts = (sitMes.puntos || []).filter((pt) => pt.tipo === 'lpr' && pt.proc);
    if (lprPts.length) {
      graficas.push({ key: 'procedencia_camara', titulo: 'Procedencia por cámara de tráfico (matrículas)', spec: { tipo: 'bar', labels: lprPts.map((pt) => pt.titulo.replace('Cámara ', '').replace('Rotonda ', '')), datasets: [{ label: 'Nacional', data: lprPts.map((pt) => pt.proc.nacional), color: '#16a34a' }, { label: 'Extranjero', data: lprPts.map((pt) => pt.proc.extranjero), color: '#2563eb' }] } });
      const totNac = lprPts.reduce((a, pt) => a + pt.proc.nacional, 0), totExt = lprPts.reduce((a, pt) => a + pt.proc.extranjero, 0);
      if (totNac + totExt) kpis.push({ label: 'Matrícula extranjera', valor: Math.round(1000 * totExt / (totNac + totExt)) / 10, unidad: '%' });
    }
    if (sitMes.kpis && sitMes.kpis.peatones) kpis.push({ label: 'Peatones (aforo por franjas)', valor: sitMes.kpis.peatones });
  }
  return { kpis, comparativa: comp, graficas };
}
function mesesCamaras(cam) {
  const set = new Set();
  Object.keys((cam.lpr && cam.lpr.entradasSalidasPorMes) || {}).forEach((k) => { if (/^\d{4}-\d{2}$/.test(k)) set.add(k); });
  (cam.multiobjeto || []).forEach((r) => { if (/^\d{4}-\d{2}$/.test(r.fecha || '')) set.add(r.fecha); });
  return Array.from(set).sort();
}

/* ===================== RESIDUOS ===================== */
// El camión crudo no trae "salidas": se agrega por mes (kg=suma, salidas=nº de recogidas).
function camionResumen(camionRaw) {
  const by = {};
  camionRaw.forEach((r) => { const f = String(r.fecha || ''); if (!/^\d{4}-\d{2}/.test(f)) return; const ym = f.slice(0, 7); if (!by[ym]) by[ym] = { fecha: ym, kg: 0, salidas: 0 }; by[ym].kg += (+r.kg || +r.weight || 0); by[ym].salidas += 1; });
  return Object.values(by);
}
function resMes(dataCamion, anio, mes) { const pref = mes ? (anio + '-' + pad2(mes)) : String(anio); let kg = 0, sal = 0, f = false; dataCamion.forEach((r) => { if (r.fecha && String(r.fecha).indexOf(pref) === 0) { kg += (+r.kg || 0); sal += (+r.salidas || 0); f = true; } }); return f ? { kg, salidas: sal } : null; }
function resAnual(dataCamion) { const by = {}; dataCamion.forEach((r) => { if (r.fecha) { const y = String(r.fecha).slice(0, 4); by[y] = (by[y] || 0) + (+r.kg || 0); } }); const years = Object.keys(by).sort().slice(-8); return { years, vals: years.map((y) => Math.round(by[y])) }; }
function buildResiduos(dataCamion, gp, anio, mes) {
  const cur = resMes(dataCamion, anio, mes) || { kg: null, salidas: null }, prev = String(+anio - 1); let ma = null;
  if (mes) { const pm = (+mes) - 1; ma = pm >= 1 ? resMes(dataCamion, anio, pm) : resMes(dataCamion, prev, 12); }
  const aa = resMes(dataCamion, prev, mes);
  const serie = {}; dataCamion.forEach((r) => { if (r.fecha && String(r.fecha).slice(0, 4) === String(anio)) { const m = parseInt(String(r.fecha).slice(5, 7), 10); serie[m] = { kg: (+r.kg || 0), salidas: (+r.salidas || 0) }; } });
  const mo = Object.keys(serie).map(Number).sort((a, b) => a - b);
  const comp = [
    { label: 'Kg recogidos', actual: cur.kg, mesAnterior: ma ? ma.kg : null, anioAnterior: aa ? aa.kg : null, varMes: pct(cur.kg, ma && ma.kg), varAnio: pct(cur.kg, aa && aa.kg) },
    { label: 'Salidas', actual: cur.salidas, mesAnterior: ma ? ma.salidas : null, anioAnterior: aa ? aa.salidas : null, varMes: pct(cur.salidas, ma && ma.salidas), varAnio: pct(cur.salidas, aa && aa.salidas) }
  ];
  const graficas = [];
  if (mo.length) {
    graficas.push({ key: 'kg_mes', titulo: 'Kg recogidos por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map(mesNombre), datasets: [{ label: 'Kg', data: mo.map((m) => serie[m].kg), color: '#2563eb' }] } });
    graficas.push({ key: 'salidas_mes', titulo: 'Salidas del camión por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map(mesNombre), datasets: [{ label: 'Salidas', data: mo.map((m) => serie[m].salidas), color: '#f59e0b' }] } });
  }
  graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: compSpec(comp) });
  const frac = { envases: 0, organica: 0, papel: 0 }; let gpTotal = 0, gpItems = [];
  if (gp && gp.datos) {
    const claves = mes ? [anio + '-' + pad2(mes)] : (gp.meses || []).filter((k) => k.slice(0, 4) === String(anio));
    const acc = {}; claves.forEach((k) => { const dm = gp.datos[k] || {}; Object.keys(dm).forEach((e) => { const d = dm[e]; acc[e] = (acc[e] || 0) + d.total; frac.envases += d.envases || 0; frac.organica += d.organica || 0; frac.papel += d.papel || 0; }); });
    gpItems = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => ({ n: x[0], v: Math.round(x[1]) }));
    gpTotal = frac.envases + frac.organica + frac.papel;
    if (gpItems.length) graficas.push({ key: 'grandes_productores', titulo: 'Grandes productores (kg, top 8)', spec: { tipo: 'barH', labels: gpItems.map((i) => i.n), datasets: [{ label: 'Kg', data: gpItems.map((i) => i.v), color: '#0ea5e9' }] } });
    if (gpTotal > 0) graficas.push({ key: 'reparto_fraccion', titulo: 'Reparto por fracción (grandes productores)', spec: { tipo: 'bar', labels: ['Orgánica', 'Envases mezclados', 'Papel/Cartón'], datasets: [{ label: 'Kg', data: [Math.round(frac.organica), Math.round(frac.envases), Math.round(frac.papel)], color: '#16a34a' }] } });
  }
  const an = resAnual(dataCamion); if (an.years.length > 1) graficas.push({ key: 'kg_anual', titulo: 'Kg recogidos por año', spec: { tipo: 'bar', labels: an.years, datasets: [{ label: 'Kg', data: an.vals, color: '#16a34a' }] } });
  const kpis = [{ label: 'Kg recogidos (camión)', valor: cur.kg, unidad: 'kg', comp: comp[0] }, { label: 'Salidas del camión', valor: cur.salidas, comp: comp[1] }];
  if (gpTotal > 0) { kpis.push({ label: 'Recogida grandes productores', valor: Math.round(gpTotal), unidad: 'kg' }); kpis.push({ label: 'Orgánica (grandes prod.)', valor: gpTotal ? Math.round(1000 * frac.organica / gpTotal) / 10 : 0, unidad: '%' }); }
  return { kpis, comparativa: comp, graficas };
}

/* ===================== TURISMO ===================== */
function turSerie(tur, cat, met, anio) { const s = (tur.series[cat] || []).find((x) => x.metrica === met); const o = {}; if (s) s.data.forEach((d) => { if (String(d.anyo) === String(anio)) o[+d.mes] = d.valor; }); return o; }
function turVal(tur, cat, met, anio, mes) { const m = turSerie(tur, cat, met, anio); if (mes) return m[+mes] != null ? m[+mes] : null; const v = Object.values(m).filter((x) => x != null); if (!v.length) return null; return met === 'grado_ocupacion' ? v.reduce((a, b) => a + b, 0) / v.length : v.reduce((a, b) => a + b, 0); }
function turAnual(tur, cat, met) { const s = (tur.series[cat] || []).find((x) => x.metrica === met); const by = {}; if (s) s.data.forEach((d) => { by[d.anyo] = (by[d.anyo] || 0) + (d.valor || 0); }); const years = Object.keys(by).sort().slice(-8); return { years, vals: years.map((y) => Math.round(by[y])) }; }
function turProcedencia(tur, anio, mes) { const proc = (tur.series.procedencia || []).filter((s) => s.residencia === 'ccaa' && s.nombre !== 'Total Nacional'); return proc.map((s) => { const v = (s.data || []).filter((d) => String(d.anyo) === String(anio) && (!mes || +d.mes === +mes)).reduce((a, b) => a + (b.valor || 0), 0); return { n: s.nombre, v: Math.round(v) }; }).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8); }
function buildTurismo(tur, anio, mes) {
  const prev = String(+anio - 1);
  const cmp = (cat, met, label) => { const act = turVal(tur, cat, met, anio, mes); let ma = null; const aa = turVal(tur, cat, met, prev, mes); if (mes) { const pm = (+mes) - 1; ma = pm >= 1 ? turVal(tur, cat, met, anio, pm) : turVal(tur, cat, met, prev, 12); } return { label, actual: act, mesAnterior: ma, anioAnterior: aa, varMes: pct(act, ma), varAnio: pct(act, aa) }; };
  const comp = [cmp('hoteles', 'viajeros', 'Viajeros hoteles'), cmp('hoteles', 'pernoctaciones', 'Pernoctaciones'), cmp('hoteles', 'grado_ocupacion', 'Ocupación %'), cmp('hoteles', 'adr', 'Tarifa media (ADR)')];
  const graficas = [];
  const addLine = (key, titulo, cat, met, color) => { const s = turSerie(tur, cat, met, anio); const mo = Object.keys(s).map(Number).sort((a, b) => a - b); if (mo.length && mo.some((m) => s[m] != null)) graficas.push({ key, titulo, spec: { tipo: 'line', labels: mo.map(mesNombre), datasets: [{ label: titulo, data: mo.map((m) => s[m]), color }] } }); };
  addLine('viajeros_mes', 'Viajeros en hoteles por mes (' + anio + ')', 'hoteles', 'viajeros', '#2563eb');
  addLine('pernoctaciones_mes', 'Pernoctaciones en hoteles por mes (' + anio + ')', 'hoteles', 'pernoctaciones', '#7c3aed');
  addLine('ocupacion_mes', 'Ocupación hotelera por mes % (' + anio + ')', 'hoteles', 'grado_ocupacion', '#0891b2');
  addLine('adr_mes', 'Tarifa media (ADR) por mes € (' + anio + ')', 'hoteles', 'adr', '#d97706');
  addLine('revpar_mes', 'RevPAR por mes € (' + anio + ')', 'hoteles', 'revpar', '#db2777');
  graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: compSpec(comp) });
  const tipo = [{ n: 'Hoteles', v: turVal(tur, 'hoteles', 'viajeros', anio, mes) }, { n: 'Apartamentos', v: turVal(tur, 'apartamentos', 'viajeros', anio, mes) }, { n: 'Campings', v: turVal(tur, 'campings', 'viajeros', anio, mes) }].filter((x) => x.v != null);
  if (tipo.length) graficas.push({ key: 'viajeros_por_tipo', titulo: 'Viajeros por tipo de alojamiento', spec: { tipo: 'bar', labels: tipo.map((i) => i.n), datasets: [{ label: 'Viajeros', data: tipo.map((i) => i.v), color: '#0ea5e9' }] } });
  const ocup = [{ n: 'Hoteles', v: turVal(tur, 'hoteles', 'grado_ocupacion', anio, mes) }, { n: 'Apartamentos', v: turVal(tur, 'apartamentos', 'grado_ocupacion', anio, mes) }, { n: 'Campings', v: turVal(tur, 'campings', 'grado_ocupacion', anio, mes) }].filter((x) => x.v != null);
  if (ocup.length) graficas.push({ key: 'ocupacion_por_tipo', titulo: 'Grado de ocupación por tipo (%)', spec: { tipo: 'bar', labels: ocup.map((i) => i.n), datasets: [{ label: 'Ocupación %', data: ocup.map((i) => Math.round(i.v * 10) / 10), color: '#0891b2' }] } });
  const proc = turProcedencia(tur, anio, mes);
  if (proc.length) graficas.push({ key: 'procedencia_ccaa', titulo: 'Procedencia nacional de los turistas (top CCAA)', spec: { tipo: 'barH', labels: proc.map((i) => i.n), datasets: [{ label: 'Turistas', data: proc.map((i) => i.v), color: '#7c3aed' }] } });
  const an = turAnual(tur, 'hoteles', 'viajeros'); if (an.years.length > 1) graficas.push({ key: 'viajeros_anual', titulo: 'Viajeros en hoteles por año', spec: { tipo: 'bar', labels: an.years, datasets: [{ label: 'Viajeros', data: an.vals, color: '#16a34a' }] } });
  const kpis = [
    { label: 'Viajeros hoteles', valor: turVal(tur, 'hoteles', 'viajeros', anio, mes), comp: comp[0] },
    { label: 'Pernoctaciones hoteles', valor: turVal(tur, 'hoteles', 'pernoctaciones', anio, mes), comp: comp[1] },
    { label: 'Ocupación hotelera', valor: turVal(tur, 'hoteles', 'grado_ocupacion', anio, mes), unidad: '%', comp: comp[2] },
    { label: 'Tarifa media (ADR)', valor: turVal(tur, 'hoteles', 'adr', anio, mes), unidad: '€', comp: comp[3] },
    { label: 'Estancia media', valor: turVal(tur, 'hoteles', 'estancia_media', anio, mes), unidad: 'noches' },
    { label: 'Viajeros apartamentos', valor: turVal(tur, 'apartamentos', 'viajeros', anio, mes) },
    { label: 'Viajeros campings', valor: turVal(tur, 'campings', 'viajeros', anio, mes) }
  ];
  return { kpis, comparativa: comp, graficas };
}

/* ===================== runner ===================== */
const AMBITOS = {
  camaras: {
    load: () => readJson('data/camaras/todos.json'),
    meses: (d) => mesesCamaras(d),
    build: (d, anio, mes) => buildCamaras(d, anio, mes)
  },
  residuos: {
    load: () => ({ camion: camionResumen(readJson('data/RESIDUOS/camion/todos.json')), gp: (() => { try { return readJson('data/RESIDUOS/grandes_productores.json'); } catch (e) { return null; } })() }),
    meses: (d) => Array.from(new Set(d.camion.map((r) => r.fecha).filter((f) => /^\d{4}-\d{2}$/.test(f) && f >= '2024-01'))).sort(),
    build: (d, anio, mes) => buildResiduos(d.camion, d.gp, anio, mes)
  },
  turismo: {
    load: () => readJson('data/TURISMO/todos.json'),
    meses: (d) => { const s = new Set(); ['hoteles', 'apartamentos', 'campings'].forEach((cat) => { (d.series[cat] || []).forEach((serie) => { (serie.data || []).forEach((r) => { if (r.anyo && r.mes && +r.anyo >= 2024) s.add(String(r.anyo) + '-' + pad2(r.mes)); }); }); }); return Array.from(s).sort(); },
    build: (d, anio, mes) => buildTurismo(d, anio, mes)
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
