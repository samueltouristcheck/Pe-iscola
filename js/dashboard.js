/**
 * Peñíscola Dashboard - Residuos + Cámaras LPR
 */
(function () {
  'use strict';

  let camarasData = null;
  let chartCamarasMes = null;
  let chartCamarasDia = null;
  let dataPesajes = [];
  let dataCamion = [];
  let mode = 'camaras';
  let chartZonas = null;
  let chartTipos = null;
  let chartHoteles = null;
  let chartResiduosZonasTab = null;
  let chartResiduosTiposTab = null;
  let chartResiduosHotelesTab = null;
  let chartTraficoHora = null;
  let chartTraficoDia = null;
  let chartCamarasPorCamara = null;
  let chartCamarasNacionalidad = null;
  let chartCamarasNacionalidadDona = null;
  let chartCamarasColor = null;
  let chartComparacionTiposStack = null;
  let chartComparacionTiposPct = null;
  let mapaCamaras = null;
  let mapaResiduos = null;
  let mapaZonas = null;
  let mapaResiduosGeoCache = null;
  let zonasGeojsonCache = null;
  let useResumen = false;
  /** Filas completas para la pestaña Tablas (desde todos.json o copia si ya cargamos detalle). */
  let dataPesajesDetalle = [];
  let dataCamionDetalle = [];
  /** Lista cacheada de Excels bajo pesajes/ (API Node). */
  let pesajesExcelsList = null;
  let pesajesExcelsLoadPromise = null;

  const CHART_PALETTE = ['#0369a1', '#0d9488', '#7c2d12', '#ca8a04', '#4338ca', '#be185d', '#047857', '#64748b', '#a21caf'];

  const MAP_MARKER_RADIUS = 8;
  const MAP_MARKER_WEIGHT = 2;
  const MAP_MARKER_STROKE = '#334155';
  const MAP_MARKER_OPACITY = 0.92;

  function addDashboardBasemap(map) {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);
  }

  /** Mapa claro (calles suaves, como vistas tipo Power BI); encaja con el dashboard blanco y los puntos de color. */
  function addDashboardBasemapLight(map) {
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);
  }

  /** Zona visible / puntos: bbox amplio (término + entorno inmediato) para no descartar recogidas en el límite o “fuera término” cercanas. */
  const PENISCOLA_CENTER = [40.358, 0.406];
  const PENISCOLA_MAX_BOUNDS = L.latLngBounds([40.30, 0.342], [40.452, 0.488]);
  /** Radio máximo desde el centro para puntos del mapa de residuos (incluye FUERA TÉRMINO cercano; excluye outliers GPS lejanos). */
  const MAP_RESIDUOS_MAX_KM = 62;

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function coordsEnTerminoPeniscola(lat, lng) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
    return PENISCOLA_MAX_BOUNDS.contains(L.latLng(lat, lng));
  }

  function coordsAceptablesMapaResiduos(lat, lng) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
    return haversineKm(PENISCOLA_CENTER[0], PENISCOLA_CENTER[1], lat, lng) <= MAP_RESIDUOS_MAX_KM;
  }

  function mapOptionsPeniscola(extra) {
    return Object.assign(
      {
        preferCanvas: false,
        maxBounds: PENISCOLA_MAX_BOUNDS,
        maxBoundsViscosity: 0.85,
        minZoom: 12
      },
      extra || {}
    );
  }

  /** Límites de vista más amplios solo para el mapa de contenedores (puede haber GPS justo fuera del bbox del término). */
  function mapOptionsPeniscolaResiduos(extra) {
    return Object.assign(
      {
        preferCanvas: false,
        maxBounds: L.latLngBounds([40.17, 0.20], [40.56, 0.58]),
        maxBoundsViscosity: 0.75,
        minZoom: 11
      },
      extra || {}
    );
  }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const CHART_THEME = {
    axis: '#64748B',
    grid: 'rgba(148, 163, 184, 0.35)',
    entr: '#2563EB',
    sal: '#059669',
    entrFill: 'rgba(37, 99, 235, 0.12)',
    salFill: 'rgba(5, 150, 105, 0.12)',
    entrBar: 'rgba(37, 99, 235, 0.85)',
    salBar: 'rgba(5, 150, 105, 0.75)',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e2e8f0',
    tooltipText: '#0f172a'
  };

  /**
   * Origen del backend Node (`npm start`). Si abres el HTML desde otro puerto (Live Server, etc.),
   * las rutas `/api/*` deben ir aquí; configura en index.html: window.__DASHBOARD_API_PORT__.
   */
  function apiBackendBase() {
    var loc = window.location;
    var nodePort = String(
      typeof window.__DASHBOARD_API_PORT__ !== 'undefined' && window.__DASHBOARD_API_PORT__ !== null
        ? window.__DASHBOARD_API_PORT__
        : 7777
    );
    if (loc.protocol === 'file:') return 'http://localhost:' + nodePort;
    var cur = loc.port || (loc.protocol === 'https:' ? '443' : '80');
    if (String(cur) === nodePort) return '';
    return loc.protocol + '//' + loc.hostname + ':' + nodePort;
  }

  /** Datos respecto a la URL de la página; `/api/*` siempre al servidor Node. */
  function dataUrl(relPath) {
    var s = String(relPath == null ? '' : relPath);
    try {
      if (/^https?:\/\//i.test(s)) return s;
      if (s.indexOf('/api/') === 0) {
        var base = apiBackendBase();
        return base ? base + s : new URL(s, window.location.href).href;
      }
      return new URL(s, window.location.href).href;
    } catch (e) {
      return s;
    }
  }

  /** Colores distinguibles para zonas (mapa / territorio; no normativa de residuos). */
  const ZONA_DONUT_COLORS = [
    '#0ea5e9', '#0369a1', '#14b8a6', '#0f766e', '#059669', '#15803d', '#65a30d',
    '#a16207', '#ca8a04', '#d97706', '#ea580c', '#dc2626', '#be123c', '#9d174d',
    '#86198f', '#6d28d9', '#4f46e5', '#475569', '#334155'
  ];

  const TIPO_COLOR_FALLBACK = ['#0891b2', '#db2777', '#7c3aed', '#16a34a', '#f97316', '#0ea5e9', '#c026d3', '#4f46e5'];

  function normalizeChartLabel(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Colores por tipo (contenedores ES + buen contraste en mapa claro).
   */
  function colorForTipoResiduo(label, index) {
    const n = normalizeChartLabel(label);
    if (/\bpapel\b|carton|cardboard/.test(n)) return '#1d4ed8';
    if (/envase|envases|plastico|lata|brik|metal|brick|aceit|tetrap/.test(n)) return '#d97706';
    if (/organica|compost|biomasa/.test(n)) return '#9a3412';
    if (/vidrio/.test(n)) return '#047857';
    if (/textil|ropa|calzado/.test(n)) return '#6d28d9';
    if (/sanitario/.test(n)) return '#db2777';
    if (/pilas|bateria/.test(n)) return '#b91c1c';
    if (/peligroso|toxico|contaminante/.test(n)) return '#881337';
    if (/mezcla|municipales|resto|rechazo|indiferenc|rebu\b/.test(n)) return '#576575';
    return TIPO_COLOR_FALLBACK[index % TIPO_COLOR_FALLBACK.length];
  }

  function simpleStringHash(str) {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return Math.abs(h);
  }

  function mapFillColorForBasura(label) {
    return colorForTipoResiduo(label, simpleStringHash(normalizeChartLabel(label)));
  }

  function colorsForZonaLabels(labels) {
    return labels.map((_, i) => ZONA_DONUT_COLORS[i % ZONA_DONUT_COLORS.length]);
  }

  function colorsForTipoLabels(labels) {
    return labels.map((lab, i) => colorForTipoResiduo(lab, i));
  }

  function residuosDoughnutOptions(extra) {
    return chartRadialOptions(
      mergeDeep(
        {
          cutout: '52%',
          layout: { padding: 8 },
          plugins: {
            legend: {
              position: 'right',
              align: 'center',
              labels: {
                color: CHART_THEME.axis,
                font: { size: 11, weight: '500' },
                boxWidth: 12,
                boxHeight: 12,
                padding: 10,
                usePointStyle: true,
                pointStyle: 'circle'
              }
            }
          }
        },
        extra || {}
      )
    );
  }

  function residuosDoughnutDataset(values, backgroundColor) {
    return {
      data: values,
      backgroundColor: backgroundColor,
      borderColor: '#ffffff',
      borderWidth: 2,
      hoverOffset: 10
    };
  }

  function mergeDeep(target, ...sources) {
    const out = target && typeof target === 'object' ? target : {};
    for (let si = 0; si < sources.length; si++) {
      const src = sources[si];
      if (!src || typeof src !== 'object') continue;
      const keys = Object.keys(src);
      for (let ki = 0; ki < keys.length; ki++) {
        const k = keys[ki];
        const v = src[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          out[k] = mergeDeep(out[k] || {}, v);
        } else {
          out[k] = v;
        }
      }
    }
    return out;
  }

  function chartCartesianOptions(extra) {
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            color: CHART_THEME.axis,
            font: { size: 12 },
            boxWidth: 12,
            padding: 16,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: CHART_THEME.tooltipBg,
          borderColor: CHART_THEME.tooltipBorder,
          borderWidth: 1,
          titleColor: CHART_THEME.tooltipText,
          bodyColor: CHART_THEME.tooltipText,
          padding: 14,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          border: { display: false },
          grid: { color: CHART_THEME.grid, borderDash: [3, 3] },
          ticks: { color: CHART_THEME.axis, font: { size: 11 } }
        },
        y: {
          border: { display: false },
          grid: { color: CHART_THEME.grid, borderDash: [3, 3] },
          ticks: { color: CHART_THEME.axis, font: { size: 11 } }
        }
      }
    };
    return mergeDeep({}, base, extra || {});
  }

  function chartRadialOptions(extra) {
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            color: CHART_THEME.axis,
            font: { size: 12 },
            boxWidth: 12,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: CHART_THEME.tooltipBg,
          borderColor: CHART_THEME.tooltipBorder,
          borderWidth: 1,
          titleColor: CHART_THEME.tooltipText,
          bodyColor: CHART_THEME.tooltipText,
          padding: 14,
          cornerRadius: 8
        }
      }
    };
    return mergeDeep({}, base, extra || {});
  }

  function getYearsFromEntradasSalidas(es) {
    if (!es || typeof es !== 'object') return [];
    const years = new Set();
    for (const key of Object.keys(es)) {
      if (key && key.length >= 4) years.add(key.slice(0, 4));
    }
    return Array.from(years).sort();
  }

  function filterMonthsByYear(es, year) {
    if (!es || typeof es !== 'object') return {};
    if (!year) return es;
    const filtered = {};
    for (const [k, v] of Object.entries(es)) {
      if (k.slice(0, 4) === year) filtered[k] = v;
    }
    return filtered;
  }

  function filterDaysByYear(esDia, year) {
    if (!esDia || typeof esDia !== 'object') return {};
    if (!year) return esDia;
    const filtered = {};
    for (const [k, v] of Object.entries(esDia)) {
      if (k.slice(0, 4) === year) filtered[k] = v;
    }
    return filtered;
  }

  function updateCamarasDashboard() {
    const es = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || null;
    const years = getYearsFromEntradasSalidas(es);
    const yearSelect = document.getElementById('camaras-year-select');
    const mesSelect = document.getElementById('camaras-mes-select');
    const wasEmpty = !yearSelect.options.length;
    const prevYear = yearSelect.value;
    yearSelect.innerHTML = '';
    mesSelect.innerHTML = '';
    if (years.length === 0) {
      yearSelect.appendChild(new Option('Sin datos', ''));
      mesSelect.appendChild(new Option('Sin datos', ''));
      return;
    }
    yearSelect.appendChild(new Option('Todos', ''));
    years.forEach((y) => yearSelect.appendChild(new Option(y, y)));
    if (wasEmpty && years.length) yearSelect.value = years[years.length - 1];
    else if (prevYear === '' || years.includes(prevYear)) yearSelect.value = prevYear;
    else yearSelect.value = years[years.length - 1];
    const selectedYear = yearSelect.value;
    const monthsFiltered = filterMonthsByYear(es, selectedYear);
    const monthKeys = Object.keys(monthsFiltered).sort();
    mesSelect.appendChild(new Option('Todo el año', ''));
    monthKeys.forEach((key) => {
      const [, mm] = key.split('-');
      mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || key, key));
    });
    if (monthKeys.length > 0 && !mesSelect.value) mesSelect.value = monthKeys[monthKeys.length - 1];
    updateCamarasKPIs();
    updateCamarasCharts();
  }

  function updateCamarasKPIs() {
    const yearSelect = document.getElementById('camaras-year-select');
    const mesSelect = document.getElementById('camaras-mes-select');
    const selectedYear = (yearSelect && yearSelect.value) || '';
    const selectedMes = (mesSelect && mesSelect.value) || '';
    const es = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || null;
    const monthsFiltered = filterMonthsByYear(es, selectedYear);
    let totalAvance = 0, totalRetroceso = 0, subLabel = '';
    if (selectedMes) {
      const d = monthsFiltered[selectedMes];
      if (d) { totalAvance = d.Avance || 0; totalRetroceso = d.Retroceso || 0; subLabel = MESES[parseInt(selectedMes.slice(5), 10) - 1] || selectedMes; }
    } else {
      for (const v of Object.values(monthsFiltered)) { totalAvance += v.Avance || 0; totalRetroceso += v.Retroceso || 0; }
      subLabel = selectedYear ? 'Todo ' + selectedYear : 'Todo';
    }
    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');
    document.getElementById('camaras-kpi-entradas').textContent = fmt(totalAvance);
    document.getElementById('camaras-kpi-entradas-sub').textContent = subLabel;
    document.getElementById('camaras-kpi-salidas').textContent = fmt(totalRetroceso);
    document.getElementById('camaras-kpi-salidas-sub').textContent = subLabel;
  }

  function updateCamarasCharts() {
    const yearSelect = document.getElementById('camaras-year-select');
    const mesSelect = document.getElementById('camaras-mes-select');
    const selectedYear = (yearSelect && yearSelect.value) || '';
    const selectedMes = (mesSelect && mesSelect.value) || '';
    const esMes = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || null;
    const esDia = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorDia) || null;
    const monthsFiltered = filterMonthsByYear(esMes, selectedYear);
    let daysFiltered = filterDaysByYear(esDia, selectedYear);
    if (selectedMes) {
      const byMes = {};
      for (const [k, v] of Object.entries(daysFiltered)) { if (k.startsWith(selectedMes)) byMes[k] = v; }
      daysFiltered = byMes;
    }
    const monthKeys = Object.keys(monthsFiltered).sort();
    const opts = chartCartesianOptions();
    const barRadius = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
    const lineDataset = (label, dataArr, colorKey) => ({
      label,
      data: dataArr,
      borderColor: CHART_THEME[colorKey],
      backgroundColor: colorKey === 'entr' ? CHART_THEME.entrFill : CHART_THEME.salFill,
      fill: true,
      borderWidth: 2,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: CHART_THEME[colorKey],
      pointBorderColor: CHART_THEME[colorKey]
    });
    const canvasMes = document.getElementById('chart-camaras-mes');
    const canvasDia = document.getElementById('chart-camaras-dia');
    if (chartCamarasMes) { chartCamarasMes.destroy(); chartCamarasMes = null; }
    if (chartCamarasDia) { chartCamarasDia.destroy(); chartCamarasDia = null; }
    if (canvasMes && monthKeys.length > 0) {
      chartCamarasMes = new Chart(canvasMes, {
        type: 'bar',
        data: {
          labels: monthKeys.map((k) => MESES[parseInt(k.split('-')[1], 10) - 1] || k),
          datasets: [
            { label: 'Entradas (Avance)', data: monthKeys.map((k) => (monthsFiltered[k] && monthsFiltered[k].Avance) || 0), backgroundColor: CHART_THEME.entrBar, borderRadius: barRadius },
            { label: 'Salidas (Retroceso)', data: monthKeys.map((k) => (monthsFiltered[k] && monthsFiltered[k].Retroceso) || 0), backgroundColor: CHART_THEME.salBar, borderRadius: barRadius }
          ]
        },
        options: opts
      });
    }
    const dayKeys = Object.keys(daysFiltered).sort();
    if (canvasDia && dayKeys.length > 0) {
      chartCamarasDia = new Chart(canvasDia, {
        type: 'line',
        data: {
          labels: dayKeys.map((k) => k.slice(5)),
          datasets: [
            lineDataset('Entradas (Avance)', dayKeys.map((k) => (daysFiltered[k] && daysFiltered[k].Avance) || 0), 'entr'),
            lineDataset('Salidas (Retroceso)', dayKeys.map((k) => (daysFiltered[k] && daysFiltered[k].Retroceso) || 0), 'sal')
          ]
        },
        options: opts
      });
    }
  }

  function initCamaras() {
    const yearSelect = document.getElementById('camaras-year-select');
    const mesSelect = document.getElementById('camaras-mes-select');
    const reloadBtn = document.getElementById('camaras-reload');
    if (!yearSelect || !mesSelect || !reloadBtn) return;
    yearSelect.addEventListener('change', () => {
      const es = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || null;
      const monthsFiltered = filterMonthsByYear(es, yearSelect.value || '');
      const monthKeys = Object.keys(monthsFiltered).sort();
      mesSelect.innerHTML = '';
      mesSelect.appendChild(new Option('Todo el año', ''));
      monthKeys.forEach((key) => { mesSelect.appendChild(new Option(MESES[parseInt(key.split('-')[1], 10) - 1] || key, key)); });
      if (monthKeys.length > 0) mesSelect.value = monthKeys[monthKeys.length - 1];
      updateCamarasKPIs();
      updateCamarasCharts();
    });
    mesSelect.addEventListener('change', () => { updateCamarasKPIs(); updateCamarasCharts(); });
    reloadBtn.addEventListener('click', loadCamarasData);
  }

  function loadCamarasData() {
    const placeholder = document.getElementById('camaras-placeholder');
    const content = document.getElementById('camaras-content');
    const dataSource = document.getElementById('camaras-data-source');
    if (placeholder) { placeholder.style.display = 'block'; placeholder.innerHTML = '<h3>Cargando datos de cámaras...</h3><p>Esperando datos del servidor...</p>'; }
    if (content) content.style.display = 'none';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = '/api/camaras/dashboard';
    fetch(url, { signal: controller.signal }).then((r) => { clearTimeout(timeout); if (!r.ok) throw new Error('No se pudo cargar (' + r.status + ')'); return r.json(); }).then((data) => {
      camarasData = data;
      if (placeholder) placeholder.style.display = 'none';
      if (content) content.style.display = 'block';
      const es = (data && data.lpr && data.lpr.entradasSalidasPorMes) || null;
      const count = es ? Object.keys(es).length : 0;
      if (dataSource) dataSource.innerHTML = '<h3>Fuente</h3><p>data/camaras/todos.json</p><p class="camaras-stats">' + count + ' meses</p>';
      updateCamarasDashboard();
      updateTraficoDashboard();
      updateCamarasChartsExtras();
      initCamarasTrafico();
    }).catch((err) => { clearTimeout(timeout); if (placeholder) placeholder.innerHTML = '<h3>Error al cargar cámaras</h3><p>' + (err.message || err) + '</p><p>Asegúrate de ejecutar <code>npm start</code> en la raíz del proyecto y abrir <code>http://localhost:7777</code></p>'; });
  }

  function updateTraficoDashboard() {
    const esMes = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {};
    const esDia = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorDia) || {};
    const esHora = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorHora) || {};
    const mesSelect = document.getElementById('trafico-mes-select');
    const mes = (mesSelect && mesSelect.value) || '';
    const meses = Object.keys(esMes).sort();
    let entradas = 0, salidas = 0, compEntradas = 0, compSalidas = 0, compMes = '';
    if (mes) {
      const d = esMes[mes];
      if (d) { entradas = d.Avance || 0; salidas = d.Retroceso || 0; }
      const idx = meses.indexOf(mes);
      if (idx > 0) { compMes = meses[idx - 1]; const c = esMes[compMes]; if (c) { compEntradas = c.Avance || 0; compSalidas = c.Retroceso || 0; } }
    } else {
      meses.forEach((m) => { const d = esMes[m]; if (d) { entradas += d.Avance || 0; salidas += d.Retroceso || 0; } });
      if (meses.length > 1) { compMes = meses[meses.length - 2]; const c = esMes[compMes]; if (c) { compEntradas = c.Avance || 0; compSalidas = c.Retroceso || 0; } }
    }
    const balance = entradas - salidas;
    const compBalance = compEntradas - compSalidas;
    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');
    const fmtShort = (n) => { const x = n != null ? n : 0; return x >= 1000000 ? (x / 1000000).toFixed(1) + ' M' : x >= 1000 ? (x / 1000).toFixed(0) + ' mil' : fmt(x); };
    const periodoLabel = mes ? (MESES[parseInt(mes.slice(5), 10) - 1] || mes) : 'Todo';
    document.getElementById('trafico-balance').textContent = fmtShort(balance);
    document.getElementById('trafico-balance-sub').textContent = 'Balance mes anterior: ' + fmtShort(compBalance);
    document.getElementById('trafico-entradas').textContent = fmt(entradas);
    document.getElementById('trafico-entradas-sub').textContent = 'Entradas mes anterior: ' + fmt(compEntradas);
    document.getElementById('trafico-salidas').textContent = fmt(salidas);
    document.getElementById('trafico-salidas-sub').textContent = 'Salidas mes anterior: ' + fmt(compSalidas);
    const opts = chartCartesianOptions();
    const horas = Array.from({ length: 24 }, (_, i) => String(i));
    const horaData = horas.map((h) => { const d = esHora[h] || {}; return { avance: d.Avance || 0, retroceso: d.Retroceso || 0 }; });
    const canvasHora = document.getElementById('chart-trafico-hora');
    const canvasDia = document.getElementById('chart-trafico-dia');
    if (chartTraficoHora) { chartTraficoHora.destroy(); chartTraficoHora = null; }
    if (chartTraficoDia) { chartTraficoDia.destroy(); chartTraficoDia = null; }
    try {
      if (canvasHora) {
        chartTraficoHora = new Chart(canvasHora, {
          type: 'line',
          data: {
            labels: horas.map((h) => String(parseInt(h, 10)) + ':00'),
            datasets: [
              { label: 'Entradas', data: horaData.map((d) => d.avance), borderColor: CHART_THEME.entr, backgroundColor: CHART_THEME.entrFill, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4 },
              { label: 'Salidas', data: horaData.map((d) => d.retroceso), borderColor: CHART_THEME.sal, backgroundColor: CHART_THEME.salFill, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4 }
            ]
          },
          options: opts
        });
      }
    } catch (e) { console.warn('Chart hora:', e); }
    var diaLabels = [];
    var diaAvance = [];
    var diaRetroceso = [];
    if (mes) {
      var y = parseInt(mes.slice(0, 4), 10);
      var m = parseInt(mes.slice(5), 10);
      var lastDay = new Date(y, m, 0).getDate();
      for (var d = 1; d <= lastDay; d++) {
        var key = mes + '-' + String(d).padStart(2, '0');
        var dat = esDia[key] || {};
        diaLabels.push(String(d));
        diaAvance.push(dat.Avance || 0);
        diaRetroceso.push(dat.Retroceso || 0);
      }
    } else {
      var diaKeysAll = Object.keys(esDia).sort();
      diaLabels = diaKeysAll.map((k) => k.slice(8));
      diaAvance = diaKeysAll.map((k) => (esDia[k] && esDia[k].Avance) || 0);
      diaRetroceso = diaKeysAll.map((k) => (esDia[k] && esDia[k].Retroceso) || 0);
    }
    try {
      if (canvasDia && diaLabels.length > 0) {
        chartTraficoDia = new Chart(canvasDia, {
          type: 'line',
          data: {
            labels: diaLabels,
            datasets: [
              { label: 'Entradas', data: diaAvance, borderColor: CHART_THEME.entr, backgroundColor: CHART_THEME.entrFill, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4 },
              { label: 'Salidas', data: diaRetroceso, borderColor: CHART_THEME.sal, backgroundColor: CHART_THEME.salFill, borderWidth: 2, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4 }
            ]
          },
          options: opts
        });
      }
    } catch (e) { console.warn('Chart dia:', e); }
  }

  function updateCamarasChartsExtras() {
    const byCamara = (camarasData && camarasData.lpr && camarasData.lpr.byCamara) || {};
    const byNacionalidad = (camarasData && camarasData.lpr && camarasData.lpr.byNacionalidad) || {};
    const byColor = (camarasData && camarasData.lpr && camarasData.lpr.byColor) || {};
    const opts = chartCartesianOptions();
    const barRadius = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
    const camaraEntries = Object.entries(byCamara).sort((a, b) => b[1] - a[1]);
    const nacEntries = Object.entries(byNacionalidad).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const colorEntries = Object.entries(byColor).sort((a, b) => b[1] - a[1]);
    const cCamara = document.getElementById('chart-camaras-por-camara');
    const cNac = document.getElementById('chart-camaras-nacionalidad');
    const cNacDona = document.getElementById('chart-camaras-nacionalidad-dona');
    const cColor = document.getElementById('chart-camaras-color');
    const cColorDona = document.getElementById('chart-camaras-color-dona');
    if (chartCamarasPorCamara) { chartCamarasPorCamara.destroy(); chartCamarasPorCamara = null; }
    if (chartCamarasNacionalidad) { chartCamarasNacionalidad.destroy(); chartCamarasNacionalidad = null; }
    if (chartCamarasNacionalidadDona) { chartCamarasNacionalidadDona.destroy(); chartCamarasNacionalidadDona = null; }
    if (chartCamarasColor) { chartCamarasColor.destroy(); chartCamarasColor = null; }
    if (chartCamarasColorDona) { chartCamarasColorDona.destroy(); chartCamarasColorDona = null; }
    if (cCamara && camaraEntries.length) chartCamarasPorCamara = new Chart(cCamara, { type: 'bar', data: { labels: camaraEntries.map(([k]) => k.length > 25 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'Tráfico', data: camaraEntries.map(([, v]) => v), backgroundColor: CHART_THEME.entrBar, borderRadius: barRadius }] }, options: opts });
    if (cNac && nacEntries.length) chartCamarasNacionalidad = new Chart(cNac, { type: 'bar', data: { labels: nacEntries.map(([k]) => k), datasets: [{ label: 'Vehículos', data: nacEntries.map(([, v]) => v), backgroundColor: CHART_THEME.entrBar, borderRadius: barRadius }] }, options: opts });
    if (cNacDona && nacEntries.length) chartCamarasNacionalidadDona = new Chart(cNacDona, { type: 'doughnut', data: { labels: nacEntries.map(([k]) => k), datasets: [{ data: nacEntries.map(([, v]) => v), backgroundColor: CHART_PALETTE }] }, options: chartRadialOptions({ cutout: '60%' }) });
    if (cColor && colorEntries.length) chartCamarasColor = new Chart(cColor, { type: 'bar', data: { labels: colorEntries.map(([k]) => k), datasets: [{ label: 'Vehículos', data: colorEntries.map(([, v]) => v), backgroundColor: CHART_PALETTE, borderRadius: barRadius }] }, options: opts });
    if (cColorDona && colorEntries.length) chartCamarasColorDona = new Chart(cColorDona, { type: 'doughnut', data: { labels: colorEntries.map(([k]) => k), datasets: [{ data: colorEntries.map(([, v]) => v), backgroundColor: CHART_PALETTE }] }, options: chartRadialOptions({ cutout: '60%' }) });
    var secCamara = document.getElementById('section-camaras-camara');
    if (secCamara && secCamara.classList.contains('active')) setTimeout(initMapaCamaras, 100);
  }

  function camaraLatLng(c) {
    var lat = c.lat != null ? c.lat : c.latitude;
    var lng = c.lng != null ? c.lng : (c.lon != null ? c.lon : c.longitude);
    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  function invalidateMapaCamaras() {
    if (!mapaCamaras) return;
    mapaCamaras.invalidateSize(true);
    setTimeout(function () { if (mapaCamaras) mapaCamaras.invalidateSize(true); }, 200);
  }

  function initMapaCamaras() {
    var container = document.getElementById('mapa-camaras');
    if (!container || typeof L === 'undefined') return;
    var camaras = (camarasData && camarasData.camarasMapa) || [];
    if (mapaCamaras) { mapaCamaras.remove(); mapaCamaras = null; }
    if (camaras.length === 0) {
      container.innerHTML = '<p style="padding:2rem;color:#64748b">No hay coordenadas. Ejecuta <code>npm run preparar</code> para generar datos.</p>';
      return;
    }
    container.innerHTML = '';
    container.style.minHeight = '450px';
    var center = PENISCOLA_CENTER;
    for (var ci = 0; ci < camaras.length; ci++) {
      var t0 = camaraLatLng(camaras[ci]);
      if (t0 && coordsEnTerminoPeniscola(t0[0], t0[1])) { center = t0; break; }
    }
    try {
      mapaCamaras = L.map('mapa-camaras', Object.assign({}, mapOptionsPeniscola())).setView(center, 13);
      addDashboardBasemap(mapaCamaras);
      var fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');
      camaras.forEach(function (c) {
        var ll = camaraLatLng(c);
        if (!ll || !coordsEnTerminoPeniscola(ll[0], ll[1])) return;
        var count = c.count != null ? c.count : 0;
        var nombre = (c.nombre || c.name || '').replace(/^\d+\s*-\s*/, '');
        var popup = '<strong>' + nombre + '</strong><br>Tráfico: ' + fmt(count);
        L.marker(ll).addTo(mapaCamaras).bindPopup(popup);
      });
      var allLl = camaras.map(camaraLatLng).filter(function (ll) {
        return ll && coordsEnTerminoPeniscola(ll[0], ll[1]);
      });
      if (allLl.length > 1) {
        mapaCamaras.fitBounds(L.latLngBounds(allLl), { padding: [30, 30] });
      }
      mapaCamaras.whenReady(function () {
        setTimeout(function () { if (mapaCamaras) mapaCamaras.invalidateSize(true); }, 0);
        setTimeout(function () { if (mapaCamaras) mapaCamaras.invalidateSize(true); }, 350);
      });
    } catch (e) { container.innerHTML = '<p style="padding:2rem;color:#f43f5e">Error al cargar el mapa: ' + (e.message || e) + '</p>'; }
  }

  function residuosMainVisible() {
    const el = document.getElementById('main-residuos');
    if (!el) return false;
    return window.getComputedStyle(el).display !== 'none';
  }

  function setMode(newMode) {
    mode = newMode;
    const mainResiduos = document.getElementById('main-residuos');
    const mainCamaras = document.getElementById('main-camaras');
    const mainTurismo = document.getElementById('main-turismo');
    const headerResiduos = document.getElementById('header-residuos');
    const headerCamaras = document.getElementById('header-camaras');
    const headerTurismo = document.getElementById('header-turismo');
    const navResiduos = document.getElementById('nav-residuos');
    const navCamaras = document.getElementById('nav-camaras');
    const navTurismo = document.getElementById('nav-turismo');
    const footer = document.getElementById('sidebar-footer');
    // Ocultar todo
    if (mainResiduos) mainResiduos.style.display = 'none';
    if (mainCamaras) mainCamaras.style.display = 'none';
    if (mainTurismo) mainTurismo.style.display = 'none';
    if (headerResiduos) headerResiduos.style.display = 'none';
    if (headerCamaras) headerCamaras.style.display = 'none';
    if (headerTurismo) headerTurismo.style.display = 'none';
    if (navResiduos) navResiduos.style.display = 'none';
    if (navCamaras) navCamaras.style.display = 'none';
    if (navTurismo) navTurismo.style.display = 'none';
    // Mostrar/ocultar los botones de cambio según el modo activo (el del modo actual se oculta)
    const btnCamaras = document.getElementById('mode-to-camaras');
    const btnResiduos = document.getElementById('mode-to-residuos');
    const btnTurismo = document.getElementById('mode-to-turismo');
    if (btnCamaras) btnCamaras.style.display = mode === 'camaras' ? 'none' : 'block';
    if (btnResiduos) btnResiduos.style.display = mode === 'residuos' ? 'none' : 'block';
    if (btnTurismo) btnTurismo.style.display = mode === 'turismo' ? 'none' : 'block';
    if (mode === 'residuos') {
      if (mainResiduos) mainResiduos.style.display = 'block';
      if (headerResiduos) headerResiduos.style.display = 'flex';
      if (navResiduos) navResiduos.style.display = 'block';
      if (footer) footer.textContent = 'Residuos municipales';
      setTimeout(function () { updateResiduosKPIs(); syncResiduosMapIfNeeded(); }, 50);
    } else if (mode === 'turismo') {
      if (mainTurismo) mainTurismo.style.display = 'block';
      if (headerTurismo) headerTurismo.style.display = 'flex';
      if (navTurismo) navTurismo.style.display = 'block';
      if (footer) footer.textContent = 'Turismo · datos INE';
      setTimeout(function () { if (typeof ensureTurismoLoaded === 'function') ensureTurismoLoaded().then(() => renderTurismoAll()).catch(() => {}); }, 50);
    } else {
      if (mainCamaras) mainCamaras.style.display = 'block';
      if (headerCamaras) headerCamaras.style.display = 'flex';
      if (navCamaras) navCamaras.style.display = 'block';
      if (footer) footer.textContent = 'Cámaras de tráfico';
      setTimeout(function () { invalidateMapaCamaras(); }, 120);
    }
  }

  function syncDetalleRowsFromSources() {
    if (!useResumen) {
      dataPesajesDetalle = Array.isArray(dataPesajes) ? dataPesajes.slice() : [];
      dataCamionDetalle = Array.isArray(dataCamion) ? dataCamion.slice() : [];
      return Promise.resolve();
    }
    return Promise.all([
      fetch(dataUrl('data/RESIDUOS/pesajes/todos.json'))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(dataUrl('data/RESIDUOS/camion/todos.json'))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    ]).then(([p, c]) => {
      dataPesajesDetalle = Array.isArray(p) ? p : [];
      dataCamionDetalle = Array.isArray(c) ? c : [];
    });
  }

  function loadAllData() {
    return fetch(dataUrl('data/RESIDUOS/resumen.json'))
      .then((r) => {
        if (r.ok) return r.json().then((d) => ({ useResumen: true, data: d }));
        throw new Error('No resumen');
      })
      .then((result) => {
        useResumen = result.useResumen;
        if (result.useResumen && result.data) {
          dataPesajes = (result.data.pesajes || []).map((x) => ({
            fecha: x.fecha,
            kg: x.kg,
            tipos: x.tipos && typeof x.tipos === 'object' ? x.tipos : undefined
          }));
          dataCamion = (result.data.camion || []).map((x) => ({
            fecha: x.fecha,
            kg: x.kg,
            weight: x.kg,
            salidas: x.salidas,
            zonas: x.zonas,
            tipos: x.tipos,
            hoteles: x.hoteles
          }));
          return syncDetalleRowsFromSources();
        }
        throw new Error('Sin datos');
      })
      .then(() => ({ pesajes: dataPesajes, camion: dataCamion }))
      .catch(() =>
        Promise.all([
          fetch(dataUrl('data/RESIDUOS/pesajes/todos.json'))
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => []),
          fetch(dataUrl('data/RESIDUOS/camion/todos.json'))
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])
        ]).then(([pesajes, camion]) => {
          useResumen = false;
          dataPesajes = Array.isArray(pesajes) ? pesajes : [];
          dataCamion = Array.isArray(camion) ? camion : [];
          dataPesajesDetalle = dataPesajes.slice();
          dataCamionDetalle = dataCamion.slice();
          return { pesajes: dataPesajes, camion: dataCamion };
        })
      );
  }

  function toNum(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  function anioResiduosOk(y) {
    const n = typeof y === 'number' ? y : parseInt(String(y), 10);
    const cy = new Date().getFullYear();
    return !isNaN(n) && n >= 1990 && n <= cy;
  }

  function matchesPeriodo(fecha, year, mes) {
    if (!fecha || typeof fecha !== 'string') return false;
    const m = String(fecha).match(/^(\d{4})-(\d{2})/);
    if (!m) return false;
    if (!anioResiduosOk(m[1])) return false;
    if (year && m[1] !== year) return false;
    if (mes && m[2] !== mes.slice(5)) return false;
    return true;
  }

  /** YYYY-MM solo si viene en los datos (Excels/JSON); null si no es válido */
  function mesDesdeFecha(fecha) {
    if (!fecha || typeof fecha !== 'string') return null;
    const m = fecha.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    if (!anioResiduosOk(m[1])) return null;
    return m[1] + '-' + m[2];
  }

  /** YYYY-MM desde fila (resumen, JSON camión o detalle Excel con Año/Mes_num). */
  function mesDesdeFilaRaw(r) {
    if (!r || typeof r !== 'object') return null;
    let m = mesDesdeFecha(r.fecha);
    if (m) return m;
    if (r.periodo != null && r.periodo !== '') {
      m = mesDesdeFecha(String(r.periodo));
      if (m) return m;
    }
    var an = r['Año'];
    var mn = r['Mes_num'];
    if (an != null && mn != null && an !== '' && mn !== '') {
      var y = parseInt(String(an), 10);
      var mo = parseInt(String(mn), 10);
      if (!isNaN(y) && !isNaN(mo) && anioResiduosOk(y) && mo >= 1 && mo <= 12) {
        return y + '-' + (mo < 10 ? '0' : '') + mo;
      }
    }
    return null;
  }

  function getResiduosYears() {
    const set = new Set();
    const addFrom = (arr) => {
      (arr || []).forEach((r) => {
        const mes = mesDesdeFilaRaw(r);
        if (mes) set.add(mes.slice(0, 4));
      });
    };
    addFrom(dataPesajes);
    addFrom(dataCamion);
    addFrom(dataPesajesDetalle);
    addFrom(dataCamionDetalle);
    if (Array.isArray(pesajesExcelsList)) {
      pesajesExcelsList.forEach((ex) => {
        if (ex.year != null && ex.year !== '') set.add(String(ex.year));
        else if (ex.yearMonth && ex.yearMonth.length >= 4) set.add(ex.yearMonth.slice(0, 4));
      });
    }
    return Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  function getResiduosMonths(year) {
    const set = new Set();
    const encaja = (mes) => {
      if (!mes) return false;
      if (!year) return true;
      return mes.slice(0, 4) === year;
    };
    const addFrom = (arr) => {
      (arr || []).forEach((r) => {
        const mes = mesDesdeFilaRaw(r);
        if (encaja(mes)) set.add(mes);
      });
    };
    addFrom(dataPesajes);
    addFrom(dataCamion);
    addFrom(dataPesajesDetalle);
    addFrom(dataCamionDetalle);
    if (Array.isArray(pesajesExcelsList)) {
      pesajesExcelsList.forEach((ex) => {
        if (ex.yearMonth && encaja(ex.yearMonth)) set.add(ex.yearMonth);
      });
    }
    return Array.from(set).sort();
  }

  /** Mapa YYYY-MM -> { tipoResiduo: kg } según fuente (camión o pesajes) y modo resumen/detalle. */
  function mesTiposFromCamionResumen() {
    const o = {};
    dataCamion.forEach((r) => {
      const m = mesDesdeFecha(r.fecha);
      if (!m || !r.tipos || typeof r.tipos !== 'object' || !Object.keys(r.tipos).length) return;
      o[m] = Object.assign({}, r.tipos);
    });
    return o;
  }

  function mesTiposFromCamionRaw() {
    const o = {};
    dataCamion.forEach((r) => {
      const m = mesDesdeFecha(r.fecha);
      if (!m) return;
      const t = (r.garbage || r.tipo || 'Otro').trim();
      if (!t || t === 'undefined') return;
      const w = toNum(r.weight || r.kg);
      if (!o[m]) o[m] = {};
      o[m][t] = (o[m][t] || 0) + w;
    });
    return o;
  }

  function getMesToTiposMapComparacion() {
    return useResumen ? mesTiposFromCamionResumen() : mesTiposFromCamionRaw();
  }

  function mesesEnAnioDesdeMap(mesToTipos, year) {
    if (!year) return [];
    return Object.keys(mesToTipos)
      .filter((m) => m.indexOf(year + '-') === 0)
      .sort();
  }

  function tiposOrdenadosEnAnio(mesToTipos, meses) {
    const score = {};
    meses.forEach((m) => {
      const row = mesToTipos[m] || {};
      Object.entries(row).forEach(([t, v]) => {
        score[t] = (score[t] || 0) + toNum(v);
      });
    });
    return Object.keys(score).sort((a, b) => (score[b] || 0) - (score[a] || 0));
  }

  function totalesTipoAnioDesdeMap(mesToTipos, year) {
    const meses = mesesEnAnioDesdeMap(mesToTipos, year);
    const t = {};
    meses.forEach((m) => {
      Object.entries(mesToTipos[m] || {}).forEach(([k, v]) => {
        t[k] = (t[k] || 0) + toNum(v);
      });
    });
    return t;
  }

  function escCell(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function updateComparacionTiposVista() {
    const yearSelect = document.getElementById('residuos-year');
    const year = (yearSelect && yearSelect.value) || '';
    const wrapMes = document.getElementById('comparacion-tabla-mes-tipo');
    const wrapYoy = document.getElementById('comparacion-tabla-yoy');
    const cStack = document.getElementById('chart-comparacion-tipos-stack');
    const cPct = document.getElementById('chart-comparacion-tipos-pct');
    const titDet = document.getElementById('comparacion-titulo-detalle');
    const titStack = document.getElementById('comparacion-titulo-stack');
    const titYoy = document.getElementById('comparacion-titulo-yoy');

    const mesToTipos = getMesToTiposMapComparacion();

    if (chartComparacionTiposStack) {
      chartComparacionTiposStack.destroy();
      chartComparacionTiposStack = null;
    }
    if (chartComparacionTiposPct) {
      chartComparacionTiposPct.destroy();
      chartComparacionTiposPct = null;
    }

    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');

    if (!year) {
      if (wrapMes) wrapMes.innerHTML = '<p class="residuos-section-placeholder">Selecciona un año o revisa los datos.</p>';
      if (wrapYoy) wrapYoy.innerHTML = '';
      if (titDet) titDet.textContent = 'Kg por tipo y mes';
      if (titStack) titStack.textContent = 'Total por mes y tipo';
      if (titYoy) titYoy.textContent = 'Totales anuales';
      return;
    }

    const meses = mesesEnAnioDesdeMap(mesToTipos, year);
    const tipos = tiposOrdenadosEnAnio(mesToTipos, meses);
    const yCurr = parseInt(year, 10);
    const yPrev = yCurr - 1;
    const totC = totalesTipoAnioDesdeMap(mesToTipos, year);
    const totP = totalesTipoAnioDesdeMap(mesToTipos, String(yPrev));
    const tiposUnion = Array.from(new Set([].concat(Object.keys(totC), Object.keys(totP)))).sort(
      (a, b) => toNum(totC[b]) + toNum(totP[b]) - (toNum(totC[a]) + toNum(totP[a]))
    );

    if (titDet) titDet.textContent = 'Kg por tipo y mes — ' + year;
    if (titStack) titStack.textContent = 'Peso total por mes y tipo — ' + year;
    if (titYoy) titYoy.textContent = 'Suma de carga ' + yPrev + ' vs ' + yCurr;

    if (!tipos.length) {
      if (wrapMes) wrapMes.innerHTML = '<p class="residuos-section-placeholder">Sin desglose por tipo para este año.</p>';
      if (wrapYoy) wrapYoy.innerHTML = '';
      return;
    }

    if (wrapMes) {
      let html =
        '<table class="residuos-data-table comparacion-tipos-matrix"><thead><tr><th>Tipo</th>';
      meses.forEach((m) => {
        const mm = parseInt(m.slice(5), 10);
        html += '<th>' + escCell(MESES[mm - 1] || m) + '</th>';
      });
      html += '<th>Total</th></tr></thead><tbody>';
      tipos.forEach((tipo) => {
        let rowSum = 0;
        html += '<tr><th scope="row">' + escCell(tipo) + '</th>';
        meses.forEach((m) => {
          const v = toNum((mesToTipos[m] || {})[tipo]);
          rowSum += v;
          html += '<td>' + (v ? fmt(Math.round(v)) : '—') + '</td>';
        });
        html += '<td><strong>' + fmt(Math.round(rowSum)) + '</strong></td></tr>';
      });
      html += '<tr><th scope="row">Total</th>';
      let gran = 0;
      meses.forEach((m) => {
        let colSum = 0;
        tipos.forEach((tipo) => {
          colSum += toNum((mesToTipos[m] || {})[tipo]);
        });
        gran += colSum;
        html += '<td><strong>' + fmt(Math.round(colSum)) + '</strong></td>';
      });
      html += '<td><strong>' + fmt(Math.round(gran)) + '</strong></td></tr>';
      html += '</tbody></table>';
      wrapMes.innerHTML = html;
    }

    if (wrapYoy && tiposUnion.length) {
      let html =
        '<table class="residuos-data-table"><thead><tr><th>Tipo</th><th>' +
        yPrev +
        '</th><th>' +
        yCurr +
        '</th><th>Variación %</th></tr></thead><tbody>';
      tiposUnion.forEach((tipo) => {
        const a = toNum(totP[tipo]);
        const b = toNum(totC[tipo]);
        const pctVar = a === 0 ? (b > 0 ? 100 : 0) : ((b - a) / a) * 100;
        html +=
          '<tr><td>' +
          escCell(tipo) +
          '</td><td>' +
          fmt(Math.round(a)) +
          '</td><td>' +
          fmt(Math.round(b)) +
          '</td><td>' +
          pctVar.toFixed(1).replace('.', ',') +
          '%</td></tr>';
      });
      const sumA = tiposUnion.reduce((s, t) => s + toNum(totP[t]), 0);
      const sumB = tiposUnion.reduce((s, t) => s + toNum(totC[t]), 0);
      const pctT = sumA === 0 ? (sumB > 0 ? 100 : 0) : ((sumB - sumA) / sumA) * 100;
      html +=
        '<tr><th scope="row">Total</th><th>' +
        fmt(Math.round(sumA)) +
        '</th><th>' +
        fmt(Math.round(sumB)) +
        '</th><th>' +
        pctT.toFixed(1).replace('.', ',') +
        '%</th></tr></tbody></table>';
      wrapYoy.innerHTML = html;
    } else if (wrapYoy) wrapYoy.innerHTML = '';

    if (cStack && meses.length && tipos.length) {
      const labels = meses.map((m) => {
        const mm = parseInt(m.slice(5), 10);
        return MESES[mm - 1] || m;
      });
      const cols = colorsForTipoLabels(tipos);
      const barRadius = { topLeft: 2, topRight: 2, bottomLeft: 0, bottomRight: 0 };
      const datasets = tipos.map((tipo, i) => ({
        label: tipo.length > 28 ? tipo.slice(0, 26) + '…' : tipo,
        data: meses.map((m) => toNum((mesToTipos[m] || {})[tipo])),
        backgroundColor: cols[i],
        borderWidth: 0,
        borderRadius: barRadius,
        stack: 't'
      }));
      chartComparacionTiposStack = new Chart(cStack, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: chartCartesianOptions({
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 10, font: { size: 10 }, padding: 8 }
            },
            title: { display: false }
          },
          scales: {
            x: { stacked: true, ticks: { maxRotation: 45, minRotation: 0 } },
            y: {
              stacked: true,
              ticks: {
                callback: function (val) {
                  return val >= 1e6 ? val / 1e6 + ' M' : val.toLocaleString('es-ES');
                }
              }
            }
          }
        })
      });
    }

    if (cPct && tiposUnion.length) {
      const labelsPct = tiposUnion.map((t) => (t.length > 16 ? t.slice(0, 14) + '…' : t));
      const dataPrev = [];
      const dataCurr = [];
      tiposUnion.forEach((tipo) => {
        const a = toNum(totP[tipo]);
        const b = toNum(totC[tipo]);
        const s = a + b;
        if (s <= 0) {
          dataPrev.push(0);
          dataCurr.push(0);
        } else {
          dataPrev.push((100 * a) / s);
          dataCurr.push((100 * b) / s);
        }
      });
      chartComparacionTiposPct = new Chart(cPct, {
        type: 'bar',
        data: {
          labels: labelsPct,
          datasets: [
            {
              label: 'Año ' + yPrev,
              data: dataPrev,
              backgroundColor: 'rgba(147, 197, 253, 0.92)',
              borderRadius: 4,
              stack: 'p'
            },
            {
              label: 'Año ' + yCurr,
              data: dataCurr,
              backgroundColor: 'rgba(30, 64, 175, 0.92)',
              borderRadius: 4,
              stack: 'p'
            }
          ]
        },
        options: chartCartesianOptions({
          plugins: { legend: { position: 'top' } },
          scales: {
            x: { stacked: true, ticks: { maxRotation: 45, minRotation: 0 } },
            y: {
              stacked: true,
              max: 100,
              ticks: {
                callback: function (v) {
                  return v + '%';
                }
              }
            }
          }
        })
      });
    }

    setTimeout(function () {
      try {
        if (chartComparacionTiposStack) chartComparacionTiposStack.resize();
        if (chartComparacionTiposPct) chartComparacionTiposPct.resize();
      } catch (e) {
        /* vacío */
      }
    }, 150);
  }

  function mapaPuntoMesYyyyMm(p) {
    const f = String(p.fecha || '');
    if (f.length >= 7 && /^\d{4}-\d{2}/.test(f)) return f.slice(0, 7);
    const fd = String(p.fecha_dia || '');
    if (fd.length >= 7 && /^\d{4}-\d{2}/.test(fd)) return fd.slice(0, 7);
    return '';
  }

  function filterMapaResiduosSample(points, year, mes) {
    if (!Array.isArray(points)) return [];
    return points.filter((p) => matchesPeriodo(mapaPuntoMesYyyyMm(p), year || '', mes || ''));
  }

  function mapaPointDedupeKey(p) {
    const mm = mapaPuntoMesYyyyMm(p);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const latR = (Math.round(lat * 1e5) / 1e5).toFixed(5);
    const lngR = (Math.round(lng * 1e5) / 1e5).toFixed(5);
    return [
      mm,
      latR,
      lngR,
      String(p.matricula || '').trim(),
      String(p.fecha_dia || '').trim(),
      String(p.garbage || '').trim()
    ].join('|');
  }

  function camionTodosRowToMapaPoint(r) {
    if (!r || typeof r !== 'object') return null;
    const la = r.lat != null ? Number(r.lat) : null;
    const ln = r.lng != null ? Number(r.lng) : null;
    if (la == null || ln == null || isNaN(la) || isNaN(ln)) return null;
    if (Math.abs(la) < 1e-6 && Math.abs(ln) < 1e-6) return null;
    const fecha = String(r.fecha || '');
    const kg = toNum(r.weight != null ? r.weight : r.kg);
    return {
      fecha,
      fecha_dia: r.fecha_dia || (fecha.length === 7 ? fecha + '-01' : ''),
      lat: la,
      lng: ln,
      zona: String(r.zona || '').trim(),
      address: '',
      resource: String(r.resource || '').trim(),
      matricula: String(r.matricula || '').trim(),
      garbage: String(r.garbage || r.tipo || '').trim(),
      containerType: String(r.containerType || '').trim(),
      weight: kg,
      area: String(r.area || '').trim()
    };
  }

  function mergeMapaConTodos(baseList, todosList) {
    const seen = new Set();
    const out = [];
    const push = (p) => {
      const k = mapaPointDedupeKey(p);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(p);
    };
    if (Array.isArray(baseList)) baseList.forEach(push);
    if (Array.isArray(todosList)) {
      for (let i = 0; i < todosList.length; i++) {
        const p = camionTodosRowToMapaPoint(todosList[i]);
        if (p) push(p);
      }
    }
    return out;
  }

  function fetchJsonArrayOrEmpty(url) {
    return fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => (Array.isArray(data) ? data : []))
      .catch(() => []);
  }

  /**
   * Puntos GPS: mapa.json o mapa_sample.json, unido con camion/todos.json (mismas recogidas + coordenadas que a veces no están en mapa).
   * Sin lanzar (mapa vacío si falla todo).
   */
  function ensureMapaResiduosPoints() {
    if (mapaResiduosGeoCache) return Promise.resolve(mapaResiduosGeoCache);
    const uMapa = dataUrl('data/RESIDUOS/camion/mapa.json');
    const uSample = dataUrl('data/RESIDUOS/camion/mapa_sample.json');
    const uTodos = dataUrl('data/RESIDUOS/camion/todos.json');
    return Promise.all([
      fetchJsonArrayOrEmpty(uMapa),
      fetchJsonArrayOrEmpty(uSample),
      fetchJsonArrayOrEmpty(uTodos)
    ]).then(([mapaArr, sampleArr, todosArr]) => {
      const base = mapaArr.length > 0 ? mapaArr : sampleArr;
      mapaResiduosGeoCache = mergeMapaConTodos(base, todosArr);
      return mapaResiduosGeoCache;
    });
  }



  function collectMesesFromMapaPoints(points) {
    const s = new Set();
    if (!Array.isArray(points)) return s;
    for (let i = 0; i < points.length; i++) {
      const k = mapaPuntoMesYyyyMm(points[i]);
      if (k.length === 7) s.add(k);
    }
    return s;
  }

  /** El resumen puede incluir meses sin puntos en mapa.json/mapa_sample (p. ej. camión sí, GPS aún no). Alinea el desplegable. */
  function syncMesSelectWithMapaData() {
    const mesSelect = document.getElementById('residuos-mes');
    const yearSelect = document.getElementById('residuos-year');
    if (!mesSelect || !yearSelect) return Promise.resolve();
    return ensureMapaResiduosPoints()
      .then((points) => {
        const mesesMapa = collectMesesFromMapaPoints(points);
        if (mesesMapa.size === 0) return;
        const current = mesSelect.value;
        if (!current) return;
        if (mesesMapa.has(current)) return;
        const candidates = [];
        for (let i = 0; i < mesSelect.options.length; i++) {
          const v = mesSelect.options[i].value;
          if (v && mesesMapa.has(v)) candidates.push(v);
        }
        candidates.sort();
        let pick = '';
        if (candidates.length) pick = candidates[candidates.length - 1];
        else {
          const y = yearSelect.value || '';
          const fallback = [];
          mesesMapa.forEach((m) => {
            if (!y || m.indexOf(y + '-') === 0) fallback.push(m);
          });
          fallback.sort();
          if (fallback.length) pick = fallback[fallback.length - 1];
        }
        if (pick) mesSelect.value = pick;
      })
      .catch(function () {});
  }

  function camionRowsPeriodOnly(year, mes) {
    const rows = [];
    dataCamion.forEach((r) => {
      if (!matchesPeriodo(r.fecha, year, mes)) return;
      rows.push(r);
    });
    return rows;
  }

  function rowPassesMapGeo(r, fromSample) {
    const la = fromSample ? Number(r.lat) : (r.lat != null ? Number(r.lat) : null);
    const ln = fromSample ? Number(r.lng) : (r.lng != null ? Number(r.lng) : (r.lon != null ? Number(r.lon) : null));
    if (la == null || ln == null || isNaN(la) || isNaN(ln)) return false;
    return coordsAceptablesMapaResiduos(la, ln);
  }

  function mapRecordMatricula(r, fromSample) {
    if (fromSample) return String(r.matricula || '').trim();
    return String(r.matricula || r.resource || '').trim();
  }

  function mapRecordGarbage(r, fromSample) {
    if (fromSample) return String(r.garbage || '').trim();
    return String(r.garbage || r.tipo || '').trim();
  }

  function mapRecordContainerType(r, fromSample) {
    return String(r.containerType || '').trim();
  }

  function populateMapaFilters(periodRecords, fromSample) {
    const matSel = document.getElementById('mapa-filter-matricula');
    const garSel = document.getElementById('mapa-filter-garbage');
    const conSel = document.getElementById('mapa-filter-container');
    const trunc = (s, n) => {
      const t = String(s || '');
      return t.length > n ? t.slice(0, n - 1) + '…' : t;
    };
    const fill = (sel, values) => {
      if (!sel) return;
      const prev = sel.value;
      const opts = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
      sel.innerHTML = '<option value="">Todas</option>';
      opts.forEach((v) => {
        const sv = String(v);
        sel.appendChild(new Option(trunc(sv, 50), sv));
      });
      if (prev && opts.indexOf(prev) !== -1) sel.value = prev;
    };
    fill(
      matSel,
      periodRecords.map((r) => mapRecordMatricula(r, fromSample))
    );
    fill(
      garSel,
      periodRecords.map((r) => mapRecordGarbage(r, fromSample))
    );
    fill(
      conSel,
      periodRecords.map((r) => mapRecordContainerType(r, fromSample))
    );
  }

  function applyMapaSlicers(periodRecords, fromSample) {
    const matF = ((document.getElementById('mapa-filter-matricula') || {}).value || '').trim();
    const garF = ((document.getElementById('mapa-filter-garbage') || {}).value || '').trim();
    const conF = ((document.getElementById('mapa-filter-container') || {}).value || '').trim();
    return periodRecords.filter((r) => {
      if (matF && mapRecordMatricula(r, fromSample) !== matF) return false;
      if (garF && mapRecordGarbage(r, fromSample) !== garF) return false;
      if (conF && mapRecordContainerType(r, fromSample) !== conF) return false;
      return true;
    });
  }

  function zoneCentroidsKg(year, mes) {
    if (useResumen) return [];
    const agg = {};
    dataCamion.forEach((r) => {
      if (!matchesPeriodo(r.fecha, year, mes)) return;
      const z = (r.zona || 'Sin zona').trim();
      if (!z || /peñiscola|sin zona/i.test(z)) return;
      const la = r.lat != null ? Number(r.lat) : null;
      const ln = r.lng != null ? Number(r.lng) : (r.lon != null ? Number(r.lon) : null);
      if (la == null || ln == null || isNaN(la) || isNaN(ln)) return;
      if (!coordsEnTerminoPeniscola(la, ln)) return;
      const w = toNum(r.weight != null ? r.weight : r.kg);
      if (!agg[z]) agg[z] = { sumLat: 0, sumLng: 0, n: 0, kg: 0 };
      agg[z].sumLat += la;
      agg[z].sumLng += ln;
      agg[z].n += 1;
      agg[z].kg += w;
    });
    return Object.entries(agg).map(([name, o]) => ({
      name,
      lat: o.sumLat / o.n,
      lng: o.sumLng / o.n,
      kg: o.kg
    }));
  }

  function normalizarZonaKey(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function nombreZonaDesdeFeature(feature) {
    const p = feature.properties || {};
    const raw = p.name ?? p.Name ?? p.nombre ?? p.Nombre ?? p.zona ?? p.ZONA ?? p.label ?? p.title ?? '';
    return String(raw).trim();
  }

  function kgParaZonaEnPoligono(kgMap, nombreGeometrico) {
    const n = String(nombreGeometrico || '').trim();
    if (Object.prototype.hasOwnProperty.call(kgMap, n)) return toNum(kgMap[n]);
    const nk = normalizarZonaKey(n);
    for (const [k, v] of Object.entries(kgMap)) {
      if (normalizarZonaKey(k) === nk) return toNum(v);
    }
    for (const [k, v] of Object.entries(kgMap)) {
      const kk = normalizarZonaKey(k);
      if (nk && kk && (nk.includes(kk) || kk.includes(nk))) return toNum(v);
    }
    return 0;
  }

  /** Clave en `kgMap` que corresponde al nombre del polígono GeoJSON (misma lógica que kg). */
  function claveKgZonaParaPoligono(kgMap, nombreGeometrico) {
    const map = kgMap || {};
    const n = String(nombreGeometrico || '').trim();
    if (Object.prototype.hasOwnProperty.call(map, n)) return n;
    const nk = normalizarZonaKey(n);
    for (const k of Object.keys(map)) {
      if (normalizarZonaKey(k) === nk) return k;
    }
    for (const k of Object.keys(map)) {
      const kk = normalizarZonaKey(k);
      if (nk && kk && (nk.includes(kk) || kk.includes(nk))) return k;
    }
    return null;
  }

  function zonaFiltroCoincideNombreGeo(filtro, nombreOEtiqueta) {
    if (!filtro) return true;
    const a = normalizarZonaKey(nombreOEtiqueta);
    const b = normalizarZonaKey(filtro);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return false;
  }

  function poligonoZonaResaltada(filtro, nombreGeo, kgMap) {
    if (!filtro) return true;
    if (zonaFiltroCoincideNombreGeo(filtro, nombreGeo)) return true;
    for (const k of Object.keys(kgMap || {})) {
      if (!zonaFiltroCoincideNombreGeo(filtro, k)) continue;
      if (zonaFiltroCoincideNombreGeo(k, nombreGeo)) return true;
    }
    return false;
  }

  function getZonasSlicerValue() {
    const el = document.getElementById('zonas-slicer-zona');
    return (el && el.value) ? el.value : '';
  }

  function populateZonasSlicer(zonasEntries) {
    const sel = document.getElementById('zonas-slicer-zona');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    sel.appendChild(new Option('Todas las zonas', ''));
    (zonasEntries || []).forEach(([k]) => {
      const label = k.length > 48 ? k.slice(0, 46) + '…' : k;
      sel.appendChild(new Option(label, k));
    });
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function applyZonasDonutHighlight() {
    if (!chartResiduosZonasTab) return;
    const sel = getZonasSlicerValue();
    const labels = chartResiduosZonasTab.data.labels;
    const base = colorsForZonaLabels(labels);
    chartResiduosZonasTab.data.datasets[0].backgroundColor = labels.map((lab, i) => {
      if (!sel) return base[i];
      return zonaFiltroCoincideNombreGeo(sel, lab) ? base[i] : 'rgba(203, 213, 225, 0.45)';
    });
    chartResiduosZonasTab.update('none');
  }

  function updateZonasTabKpiAndChart() {
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const year = (yearSelect && yearSelect.value) || '';
    const mes = (mesSelect && mesSelect.value) || '';
    const kgMap = buildKgPorZona(year, mes);
    const sel = getZonasSlicerValue();
    const kpiEl = document.getElementById('zonas-kpi-kg');
    let kg = 0;
    if (!sel) {
      Object.values(kgMap).forEach((v) => { kg += toNum(v); });
    } else if (Object.prototype.hasOwnProperty.call(kgMap, sel)) {
      kg = toNum(kgMap[sel]);
    } else {
      kg = toNum(kgParaZonaEnPoligono(kgMap, sel));
    }
    if (kpiEl) kpiEl.textContent = kg.toLocaleString('es-ES') + ' kg';
    applyZonasDonutHighlight();
  }

  /** Misma agregación por zona que el gráfico de dona (periodo año/mes). */
  function buildKgPorZona(year, mes) {
    const byZona = {};
    if (useResumen) {
      dataCamion.forEach((r) => {
        if (!matchesPeriodo(r.fecha, year, mes)) return;
        const z = r.zonas || {};
        Object.entries(z).forEach(([k, v]) => { byZona[k] = (byZona[k] || 0) + toNum(v); });
      });
    } else {
      dataCamion.forEach((r) => {
        if (!matchesPeriodo(r.fecha, year, mes)) return;
        const z = (r.zona || 'Sin zona').trim();
        if (z && !/peñiscola|sin zona/i.test(z)) byZona[z] = (byZona[z] || 0) + toNum(r.weight || r.kg);
      });
    }
    return byZona;
  }

  function initMapaResiduos() {
    const container = document.getElementById('mapa-residuos');
    if (!container || typeof L === 'undefined') return;
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const year = (yearSelect && yearSelect.value) || '';
    const mes = (mesSelect && mesSelect.value) || '';
    if (mapaResiduos) { mapaResiduos.remove(); mapaResiduos = null; }
    container.innerHTML = '';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtKg = (n) => (n != null ? n : 0).toLocaleString('es-ES');

    const updateMapaResiduosSidePanel = (records, fromSample) => {
      const elMat = document.getElementById('mapa-kpi-matricula');
      const elN = document.getElementById('mapa-kpi-contenedores');
      const elAvg = document.getElementById('mapa-kpi-peso-promedio');
      const leg = document.getElementById('mapa-residuos-legend');
      const matSel = document.getElementById('mapa-filter-matricula');
      const matF = matSel && matSel.value ? String(matSel.value).trim() : '';

      if (!records || !records.length) {
        if (elMat) elMat.textContent = '—';
        if (elN) elN.textContent = '—';
        if (elAvg) elAvg.textContent = '—';
        if (leg) {
          leg.innerHTML = '';
          leg.hidden = true;
        }
        return;
      }

      let matDisplay = matF || 'Todas';
      if (!matF) {
        const mats = [...new Set(records.map((r) => mapRecordMatricula(r, fromSample)).filter(Boolean))];
        if (mats.length === 1) matDisplay = mats[0];
      }
      if (elMat) elMat.textContent = matDisplay;

      const n = records.length;
      if (elN) elN.textContent = String(n);

      let sumKg = 0;
      records.forEach((r) => {
        sumKg += fromSample ? toNum(r.weight) : toNum(r.weight !== undefined && r.weight !== null ? r.weight : r.kg);
      });
      const avg = n > 0 ? sumKg / n : 0;
      if (elAvg) {
        elAvg.textContent =
          (avg > 0
            ? avg.toLocaleString('es-ES', {
              maximumFractionDigits: 1,
              minimumFractionDigits: avg % 1 === 0 ? 0 : 1
            })
            : '0') + ' kg';
      }

      if (leg) {
        const byTipo = {};
        records.forEach((r) => {
          const t = mapRecordGarbage(r, fromSample) || 'Sin tipo';
          byTipo[t] = (byTipo[t] || 0) + 1;
        });
        const tipos = Object.keys(byTipo).sort((a, b) => byTipo[b] - byTipo[a]);
        if (tipos.length === 0) {
          leg.innerHTML = '';
          leg.hidden = true;
        } else {
          leg.hidden = false;
          leg.innerHTML = '';
          const title = document.createElement('div');
          title.className = 'mapa-legend-title';
          title.textContent = 'Tipo de basura';
          leg.appendChild(title);
          tipos.forEach((t) => {
            const row = document.createElement('div');
            row.className = 'mapa-legend-row';
            const sw = document.createElement('span');
            sw.className = 'mapa-legend-swatch';
            sw.style.background = mapFillColorForBasura(t);
            const lab = document.createElement('span');
            lab.className = 'mapa-legend-label';
            lab.textContent = t;
            const cnt = document.createElement('span');
            cnt.className = 'mapa-legend-count';
            cnt.textContent = String(byTipo[t]);
            row.appendChild(sw);
            row.appendChild(lab);
            row.appendChild(cnt);
            leg.appendChild(row);
          });
        }
      }
    };

    const addMarkersFromRecords = (records, fromSample) => {
      updateMapaResiduosSidePanel(records, fromSample);
      const layerGroup = L.layerGroup();
      const latlngs = [];
      records.forEach((r) => {
        const la = fromSample ? Number(r.lat) : (r.lat != null ? Number(r.lat) : null);
        const ln = fromSample ? Number(r.lng) : (r.lng != null ? Number(r.lng) : (r.lon != null ? Number(r.lon) : null));
        if (la == null || ln == null || isNaN(la) || isNaN(ln)) return;
        if (!coordsAceptablesMapaResiduos(la, ln)) return;
        latlngs.push([la, ln]);
        const kg = fromSample ? toNum(r.weight) : toNum(r.weight != null ? r.weight : r.kg);
        const zona = fromSample ? (r.zona || '') : (r.zona || '');
        const fecha = fromSample ? (r.fecha_dia || r.fecha || '') : (r.fecha || '');
        const tipo = fromSample ? (r.garbage || '') : String(r.garbage || r.tipo || '').trim();
        const mat = fromSample ? (r.matricula || '') : String(r.matricula || r.resource || '').trim();
        const ctipo = fromSample ? String(r.containerType || '').trim() : String(r.containerType || '').trim();
        const fill = mapFillColorForBasura(tipo || 'Sin tipo');
        const mk = L.circleMarker([la, ln], {
          radius: MAP_MARKER_RADIUS,
          weight: MAP_MARKER_WEIGHT,
          color: MAP_MARKER_STROKE,
          fillColor: fill,
          fillOpacity: MAP_MARKER_OPACITY
        });
        let popup = '<strong>Contenedor</strong><br>' + esc(zona || 'Sin zona') + '<br>' + esc(fecha) + '<br>' + fmtKg(kg) + ' kg';
        if (tipo) popup += '<br><span style="color:#64748b">' + esc(tipo) + '</span>';
        if (ctipo) popup += '<br><small style="color:#64748b">' + esc(ctipo) + '</small>';
        if (mat) popup += '<br><small>Mat. ' + esc(mat) + '</small>';
        mk.bindPopup(popup);
        layerGroup.addLayer(mk);
      });
      mapaResiduos = L.map('mapa-residuos', mapOptionsPeniscolaResiduos({ preferCanvas: true }));
      mapaResiduos.setView(PENISCOLA_CENTER, 14);
      addDashboardBasemapLight(mapaResiduos);
      mapaResiduos.addLayer(layerGroup);
      if (latlngs.length) {
        mapaResiduos.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 16, animate: false });
      }
      mapaResiduos.whenReady(() => {
        setTimeout(() => { if (mapaResiduos) mapaResiduos.invalidateSize(true); }, 0);
        setTimeout(() => { if (mapaResiduos) mapaResiduos.invalidateSize(true); }, 280);
      });
    };

    const finishFromPeriod = (periodRecords, fromSample) => {
      populateMapaFilters(periodRecords, fromSample);
      const sliced = applyMapaSlicers(periodRecords, fromSample);
      const withGeo = sliced.filter((r) => rowPassesMapGeo(r, fromSample));
      addMarkersFromRecords(withGeo, fromSample);
    };

    if (!useResumen) {
      const periodAll = camionRowsPeriodOnly(year, mes);
      const anyGeo = periodAll.some((r) => rowPassesMapGeo(r, false));
      if (anyGeo) {
        finishFromPeriod(periodAll, false);
        return;
      }
      ensureMapaResiduosPoints()
        .then((all) => {
          finishFromPeriod(filterMapaResiduosSample(all, year, mes), true);
        })
        .catch(() => {
          finishFromPeriod([], true);
        });
      return;
    }

    ensureMapaResiduosPoints()
      .then((all) => {
        finishFromPeriod(filterMapaResiduosSample(all, year, mes), true);
      })
      .catch(() => {
        finishFromPeriod([], true);
      });
  }

  function initMapaZonasResiduos() {
    const container = document.getElementById('mapa-zonas-residuos');
    if (!container || typeof L === 'undefined') return;
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const year = (yearSelect && yearSelect.value) || '';
    const mes = (mesSelect && mesSelect.value) || '';
    if (mapaZonas) { mapaZonas.remove(); mapaZonas = null; }
    container.innerHTML = '';

    mapaZonas = L.map('mapa-zonas-residuos', Object.assign({}, mapOptionsPeniscola()));
    mapaZonas.setView(PENISCOLA_CENTER, 14);
    addDashboardBasemapLight(mapaZonas);

    const kgMap = buildKgPorZona(year, mes);
    const selFiltroZona = getZonasSlicerValue();
    const zonasKeysOrdenDonut = Object.keys(kgMap).sort((a, b) => toNum(kgMap[b]) - toNum(kgMap[a]));
    const colorPorClaveZona = {};
    zonasKeysOrdenDonut.forEach((k, i) => {
      colorPorClaveZona[k] = ZONA_DONUT_COLORS[i % ZONA_DONUT_COLORS.length];
    });

    const esc = (s) =>
      String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');

    const finishInvalidate = () => {
      mapaZonas.whenReady(() => {
        setTimeout(() => { if (mapaZonas) mapaZonas.invalidateSize(true); }, 0);
        setTimeout(() => { if (mapaZonas) mapaZonas.invalidateSize(true); }, 280);
      });
    };

    const drawCentroidFallback = () => {
      const rows = zoneCentroidsKg(year, mes);
      const selF = getZonasSlicerValue();
      const m = rows.length ? Math.max.apply(null, rows.map((r) => r.kg)) : 1;
      const ll = [];
      rows.forEach((row) => {
        const hi = poligonoZonaResaltada(selF, row.name, kgMap);
        const radius = 10 + Math.sqrt(row.kg / m) * 20;
        const claveC = Object.prototype.hasOwnProperty.call(kgMap, row.name) ? row.name : claveKgZonaParaPoligono(kgMap, row.name);
        const color = (claveC && colorPorClaveZona[claveC]) ? colorPorClaveZona[claveC] : '#cbd5e1';
        const circle = L.circleMarker([row.lat, row.lng], {
          radius,
          weight: hi ? 3 : 2,
          color: hi ? '#1f2937' : '#94a3b8',
          fillColor: color,
          opacity: hi ? 1 : 0.4,
          fillOpacity: hi ? 0.72 : 0.28
        });
        circle.bindPopup('<strong>' + esc(row.name) + '</strong><br>' + fmt(Math.round(row.kg)) + ' kg');
        circle.addTo(mapaZonas);
        ll.push([row.lat, row.lng]);
      });
      if (ll.length) mapaZonas.fitBounds(L.latLngBounds(ll), { padding: [40, 40], maxZoom: 14 });
      finishInvalidate();
    };

    (zonasGeojsonCache
      ? Promise.resolve(zonasGeojsonCache)
      : fetch(dataUrl('data/zonas_peniscola.geojson')).then((r) => {
          if (!r.ok) throw new Error('geo');
          return r.json();
        })
    )
      .then((geo) => {
        if (!geo || !geo.type) throw new Error('empty');
        if (!zonasGeojsonCache) zonasGeojsonCache = geo;
        const layer = L.geoJSON(geo, {
          filter: function (feature) {
            const t = feature.geometry && feature.geometry.type;
            return t === 'Polygon' || t === 'MultiPolygon';
          },
          style: function (feature) {
            const name = nombreZonaDesdeFeature(feature);
            const hi = poligonoZonaResaltada(selFiltroZona, name, kgMap);
            const clave = claveKgZonaParaPoligono(kgMap, name);
            const baseFill = clave ? colorPorClaveZona[clave] : '#cbd5e1';
            return {
              fillColor: baseFill,
              fillOpacity: hi ? 0.68 : (selFiltroZona ? 0.12 : 0.55),
              color: hi ? '#0f172a' : '#cbd5e1',
              weight: hi ? (selFiltroZona ? 3.5 : 2.75) : 1.25,
              opacity: hi ? 1 : 0.55
            };
          },
          onEachFeature: function (feature, lyr) {
            const name = nombreZonaDesdeFeature(feature);
            const kg = kgParaZonaEnPoligono(kgMap, name);
            lyr.bindPopup('<strong>' + esc(name || 'Zona') + '</strong><br>' + fmt(Math.round(kg)) + ' kg');
          }
        });
        layer.addTo(mapaZonas);
        try {
          const b = layer.getBounds();
          if (b.isValid()) mapaZonas.fitBounds(b, { padding: [20, 20], maxZoom: 16 });
        } catch (e) { /* vacío */ }
        finishInvalidate();
      })
      .catch(() => {
        drawCentroidFallback();
      });
  }

  function syncResiduosMapIfNeeded() {
    const sec = document.getElementById('section-mapa');
    if (sec && sec.classList.contains('active') && residuosMainVisible()) {
      setTimeout(initMapaResiduos, 120);
    }
  }

  function syncMapaZonasIfNeeded() {
    const sec = document.getElementById('section-zonas');
    if (sec && sec.classList.contains('active') && residuosMainVisible()) {
      setTimeout(initMapaZonasResiduos, 120);
    }
  }

  function updateResiduosKPIs() {
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const compareSelect = document.getElementById('residuos-compare');
    if (!yearSelect || !mesSelect) return;
    const year = yearSelect.value || '';
    const mes = mesSelect.value || '';
    const compare = (compareSelect && compareSelect.value) || 'mes_anterior';
    let kgExcel = 0, kgCamion = 0, salidas = 0;
    dataPesajes.forEach((r) => { if (matchesPeriodo(r.fecha, year, mes)) kgExcel += toNum(r.kg); });
    if (useResumen) {
      dataCamion.forEach((r) => { if (matchesPeriodo(r.fecha, year, mes)) { kgCamion += toNum(r.kg || r.weight); salidas += (r.salidas || 0); } });
    } else {
      dataCamion.forEach((r) => { if (matchesPeriodo(r.fecha, year, mes)) { kgCamion += toNum(r.weight || r.kg); salidas += 1; } });
    }
    let compKgExcel = 0, compKgCamion = 0, compSalidas = 0, compLabel = '';
    if (compare === 'mes_anterior' && mes) {
      const [y, m] = mes.split('-');
      const prev = parseInt(m, 10) - 1;
      const prevMes = prev >= 1 ? y + '-' + String(prev).padStart(2, '0') : String(parseInt(y, 10) - 1) + '-12';
      compLabel = prevMes;
      dataPesajes.forEach((r) => { if (r.fecha === prevMes) compKgExcel += toNum(r.kg); });
      if (useResumen) { const c = dataCamion.find((r) => r.fecha === prevMes); if (c) { compKgCamion = toNum(c.kg); compSalidas = c.salidas || 0; } }
      else dataCamion.forEach((r) => { if (r.fecha === prevMes) { compKgCamion += toNum(r.weight || r.kg); compSalidas += 1; } });
    } else if (compare === 'año_anterior' && year) {
      const prevYear = String(parseInt(year, 10) - 1);
      compLabel = prevYear;
      dataPesajes.forEach((r) => { if (r.fecha && r.fecha.startsWith(prevYear)) compKgExcel += toNum(r.kg); });
      if (useResumen) dataCamion.forEach((r) => { if (r.fecha && r.fecha.startsWith(prevYear)) { compKgCamion += toNum(r.kg); compSalidas += r.salidas || 0; } });
      else dataCamion.forEach((r) => { if (r.fecha && r.fecha.startsWith(prevYear)) { compKgCamion += toNum(r.weight || r.kg); compSalidas += 1; } });
    } else if (compare === 'mismo_mes_año' && mes && year) {
      const prevYear = String(parseInt(year, 10) - 1);
      const prevMes = prevYear + '-' + mes.slice(5);
      compLabel = prevMes;
      dataPesajes.forEach((r) => { if (r.fecha === prevMes) compKgExcel += toNum(r.kg); });
      if (useResumen) { const c = dataCamion.find((r) => r.fecha === prevMes); if (c) { compKgCamion = toNum(c.kg); compSalidas = c.salidas || 0; } }
      else dataCamion.forEach((r) => { if (r.fecha === prevMes) { compKgCamion += toNum(r.weight || r.kg); compSalidas += 1; } });
    }
    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');
    const pct = (curr, prev) => (prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100);
    const periodoLabel = mes ? (MESES[parseInt(mes.slice(5), 10) - 1] || mes) + ' ' + (year || '') : (year || 'Todo');
    document.getElementById('kpi-periodo-excel').textContent = periodoLabel;
    document.getElementById('kpi-value-excel').textContent = fmt(kgExcel);
    document.getElementById('kpi-compare-excel').innerHTML = compLabel ? 'vs ' + compLabel + ': <span class="kpi-diff ' + (pct(kgExcel, compKgExcel) > 0 ? 'positivo' : pct(kgExcel, compKgExcel) < 0 ? 'negativo' : 'neutro') + '">' + pct(kgExcel, compKgExcel).toFixed(2).replace('.', ',') + '%</span>' : '';
    document.getElementById('kpi-periodo-camion').textContent = periodoLabel;
    document.getElementById('kpi-value-camion').textContent = fmt(kgCamion);
    document.getElementById('kpi-compare-camion').innerHTML = compLabel ? 'vs ' + compLabel + ': <span class="kpi-diff ' + (pct(kgCamion, compKgCamion) > 0 ? 'positivo' : pct(kgCamion, compKgCamion) < 0 ? 'negativo' : 'neutro') + '">' + pct(kgCamion, compKgCamion).toFixed(2).replace('.', ',') + '%</span>' : '';
    document.getElementById('kpi-periodo-salidas').textContent = periodoLabel;
    document.getElementById('kpi-value-salidas').textContent = fmt(salidas);
    document.getElementById('kpi-compare-salidas').innerHTML = compLabel ? 'vs ' + compLabel + ': <span class="kpi-diff ' + (pct(salidas, compSalidas) > 0 ? 'positivo' : pct(salidas, compSalidas) < 0 ? 'negativo' : 'neutro') + '">' + pct(salidas, compSalidas).toFixed(2).replace('.', ',') + '%</span>' : '';
    updateResiduosCharts(year, mes);
    syncResiduosMapIfNeeded();
    syncMapaZonasIfNeeded();
    updateComparacionTiposVista();
    updateTablasFuenteCruda();
  }

  function updateResiduosCharts(year, mes) {
    const byZona = buildKgPorZona(year, mes);
    let byTipo = {}, byHotel = {};
    if (useResumen) {
      dataCamion.forEach((r) => {
        if (!matchesPeriodo(r.fecha, year, mes)) return;
        const t = r.tipos || {}, h = r.hoteles || {};
        Object.entries(t).forEach(([k, v]) => { byTipo[k] = (byTipo[k] || 0) + toNum(v); });
        Object.entries(h).forEach(([k, v]) => { byHotel[k] = (byHotel[k] || 0) + toNum(v); });
      });
    } else {
      const isHotel = (s) => /hotel|camping|aparthotel|resort|hostal/i.test(String(s || ''));
      dataCamion.forEach((r) => {
        if (!matchesPeriodo(r.fecha, year, mes)) return;
        const t = (r.garbage || r.tipo || 'Otro').trim();
        if (t && t !== 'undefined') byTipo[t] = (byTipo[t] || 0) + toNum(r.weight || r.kg);
        const est = (r.establecimiento || r.area || '').trim();
        if (est && isHotel(est) && !/peñiscola rsu|peñiscola$/i.test(est)) byHotel[est] = (byHotel[est] || 0) + toNum(r.weight || r.kg);
      });
    }
    const doughnutPalette = (n) => {
      if (n <= CHART_PALETTE.length) return CHART_PALETTE.slice(0, n);
      const out = [];
      for (let i = 0; i < n; i++) out.push(`hsl(${Math.round((360 * i) / Math.max(n, 1))} 48% 50%)`);
      return out;
    };
    const barPalette = (n) => {
      if (n <= CHART_PALETTE.length) return CHART_PALETTE.slice(0, n);
      return doughnutPalette(n);
    };
    const donutOpts = residuosDoughnutOptions();
    const barOptsHoteles = chartCartesianOptions({
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 0 } }
      }
    });
    const hotelBarRadius = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
    const zonasEntriesAll = Object.entries(byZona).sort((a, b) => b[1] - a[1]);
    const tiposEntriesAll = Object.entries(byTipo).sort((a, b) => b[1] - a[1]);
    const hotelesEntriesAll = Object.entries(byHotel).sort((a, b) => b[1] - a[1]);
    const zonasEntries = zonasEntriesAll;
    const tiposEntries = tiposEntriesAll;
    const hotelesEntries = hotelesEntriesAll;
    const cZ = document.getElementById('chart-zonas');
    const cT = document.getElementById('chart-tipos');
    const cH = document.getElementById('chart-hoteles');
    if (chartZonas) { chartZonas.destroy(); chartZonas = null; }
    if (chartTipos) { chartTipos.destroy(); chartTipos = null; }
    if (chartHoteles) { chartHoteles.destroy(); chartHoteles = null; }
    if (chartResiduosZonasTab) { chartResiduosZonasTab.destroy(); chartResiduosZonasTab = null; }
    if (chartResiduosTiposTab) { chartResiduosTiposTab.destroy(); chartResiduosTiposTab = null; }
    if (chartResiduosHotelesTab) { chartResiduosHotelesTab.destroy(); chartResiduosHotelesTab = null; }
    if (cZ && zonasEntries.length) {
      const labsZ = zonasEntries.map(([k]) => k);
      chartZonas = new Chart(cZ, {
        type: 'doughnut',
        data: { labels: labsZ, datasets: [residuosDoughnutDataset(zonasEntries.map(([, v]) => v), colorsForZonaLabels(labsZ))] },
        options: donutOpts
      });
    }
    if (cT && tiposEntries.length) {
      const labsT = tiposEntries.map(([k]) => k);
      chartTipos = new Chart(cT, {
        type: 'doughnut',
        data: { labels: labsT, datasets: [residuosDoughnutDataset(tiposEntries.map(([, v]) => v), colorsForTipoLabels(labsT))] },
        options: donutOpts
      });
    }
    if (cH && hotelesEntries.length) chartHoteles = new Chart(cH, { type: 'bar', data: { labels: hotelesEntries.map(([k]) => k.length > 22 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'kg', data: hotelesEntries.map(([, v]) => v), backgroundColor: barPalette(hotelesEntries.length), borderRadius: hotelBarRadius }] }, options: barOptsHoteles });
    const cZTab = document.getElementById('chart-residuos-zonas-tab');
    const cTTab = document.getElementById('chart-residuos-tipos-tab');
    const cHTab = document.getElementById('chart-residuos-hoteles-tab');
    if (cZTab && zonasEntries.length) {
      const labsZ = zonasEntries.map(([k]) => k);
      chartResiduosZonasTab = new Chart(cZTab, {
        type: 'doughnut',
        data: { labels: labsZ, datasets: [residuosDoughnutDataset(zonasEntries.map(([, v]) => v), colorsForZonaLabels(labsZ))] },
        options: donutOpts
      });
    }
    if (cTTab && tiposEntries.length) {
      const labsT = tiposEntries.map(([k]) => k);
      chartResiduosTiposTab = new Chart(cTTab, {
        type: 'doughnut',
        data: { labels: labsT, datasets: [residuosDoughnutDataset(tiposEntries.map(([, v]) => v), colorsForTipoLabels(labsT))] },
        options: donutOpts
      });
    }
    if (cHTab && hotelesEntries.length) chartResiduosHotelesTab = new Chart(cHTab, { type: 'bar', data: { labels: hotelesEntries.map(([k]) => k.length > 22 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'kg', data: hotelesEntries.map(([, v]) => v), backgroundColor: barPalette(hotelesEntries.length), borderRadius: hotelBarRadius }] }, options: barOptsHoteles });
    populateZonasSlicer(zonasEntries);
    updateZonasTabKpiAndChart();
    renderResiduosTablas(zonasEntriesAll, tiposEntriesAll, hotelesEntriesAll);
  }

  function renderResiduosTablas(zonasEntries, tiposEntries, hotelesEntries) {
    var fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');
    var renderTable = function (entries, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      if (!entries || entries.length === 0) { el.innerHTML = '<p class="residuos-section-placeholder">Sin datos para el periodo seleccionado.</p>'; return; }
      var html = '<table class="residuos-data-table"><thead><tr><th>Nombre</th><th>Kg</th></tr></thead><tbody>';
      entries.forEach(function (e) { html += '<tr><td>' + (e[0] || '').replace(/</g, '&lt;') + '</td><td>' + fmt(e[1]) + '</td></tr>'; });
      html += '</tbody></table>';
      el.innerHTML = html;
    };
    renderTable(zonasEntries || [], 'tabla-zonas-container');
    renderTable(tiposEntries || [], 'tabla-reciclaje-container');
    renderTable(hotelesEntries || [], 'tabla-hoteles-container');
  }

  function invalidatePesajesExcelsList() {
    pesajesExcelsList = null;
    pesajesExcelsLoadPromise = null;
  }

  function loadPesajesExcelsList() {
    if (Array.isArray(pesajesExcelsList)) return Promise.resolve({ ok: true, files: pesajesExcelsList });
    if (pesajesExcelsLoadPromise) return pesajesExcelsLoadPromise;

    function parseListResponse(d) {
      return { ok: true, files: Array.isArray(d.files) ? d.files : [] };
    }

    function tryManifest() {
      return fetch(dataUrl('data/RESIDUOS/pesajes/excels_manifest.json'), { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) return Promise.reject(new Error('no_manifest'));
          return r.json().then(parseListResponse);
        })
        .then((result) => result);
    }

    function tryApi() {
      return fetch(dataUrl('/api/residuos/pesajes/excels'))
        .then((r) => {
          if (!r.ok) return { ok: false, files: [] };
          return r
            .json()
            .then(parseListResponse)
            .catch(() => ({ ok: false, files: [] }));
        })
        .catch(() => ({ ok: false, files: [] }));
    }

    pesajesExcelsLoadPromise = tryManifest()
      .catch(() => tryApi())
      .then((result) => {
        pesajesExcelsLoadPromise = null;
        if (result.ok) pesajesExcelsList = result.files;
        return result;
      });
    return pesajesExcelsLoadPromise;
  }

  function excelPesajeMatchesFiltro(ex, year, mes) {
    if (!year && !mes) return true;
    if (mes) {
      if (ex.yearMonth) return ex.yearMonth === mes;
      return false;
    }
    if (year) {
      if (ex.year != null) return String(ex.year) === String(year);
      return false;
    }
    return true;
  }

  function pesajesExcelsSortForPeriodo(list) {
    return list.slice().sort((a, b) => {
      const ka = a.yearMonth || '\uffff';
      const kb = b.yearMonth || '\uffff';
      if (ka !== kb) return ka.localeCompare(kb);
      return (a.rel || '').localeCompare(b.rel || '', 'es');
    });
  }

  /** Elegir qué Excel mostrar según filtros: mes concreto → ese libro; solo año → último mes del año en los datos. */
  function pesajesPickDefaultRel(sortedFiltered, year, mes) {
    if (!sortedFiltered.length) return null;
    if (mes) {
      const hit = sortedFiltered.find((ex) => ex.yearMonth === mes);
      return (hit || sortedFiltered[0]).rel;
    }
    if (year) return sortedFiltered[sortedFiltered.length - 1].rel;
    return sortedFiltered[0].rel;
  }

  function pesajesExcelPreviewEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function pesajesExcelEscAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  /** Interpreta número con coma o punto decimal y separadores de miles habituales. */
  function pesajesExcelParseLocaleNumber(s) {
    const t = String(s == null ? '' : s).trim();
    if (t === '' || t === '—' || t === '-') return null;
    const lastC = t.lastIndexOf(',');
    const lastD = t.lastIndexOf('.');
    let norm = t.replace(/\s/g, '');
    if (lastC >= 0 && lastD >= 0) {
      if (lastC > lastD) norm = norm.replace(/\./g, '').replace(',', '.');
      else norm = norm.replace(/,/g, '');
    } else if (lastC >= 0) norm = norm.replace(',', '.');
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  }

  /** true si la columna va mayormente en numérico (rango min–máx); si no, desplegable de textos. */
  function pesajesExcelInferColumnKinds(dataRows, nCol) {
    const kinds = [];
    for (let c = 0; c < nCol; c++) {
      let nonEmpty = 0;
      let numericCount = 0;
      dataRows.forEach(function (row) {
        const r = Array.isArray(row) ? row : [];
        const raw = pesajesExcelCeldaTxt(r[c]).trim();
        if (raw === '') return;
        nonEmpty++;
        if (pesajesExcelParseLocaleNumber(raw) !== null) numericCount++;
      });
      const ratio = nonEmpty > 0 ? numericCount / nonEmpty : 0;
      kinds.push(nonEmpty > 0 && ratio >= 0.85 ? 'number' : 'text');
    }
    return kinds;
  }

  function pesajesExcelColumnUniqueStrings(dataRows, c) {
    const seen = new Set();
    const out = [];
    dataRows.forEach(function (row) {
      const r = Array.isArray(row) ? row : [];
      const v = pesajesExcelCeldaTxt(r[c]).trim();
      if (v === '' || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    });
    out.sort(function (a, b) {
      return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });
    return out;
  }

  function pesajesExcelColumnNumExtent(dataRows, c) {
    let minN = Infinity;
    let maxN = -Infinity;
    dataRows.forEach(function (row) {
      const r = Array.isArray(row) ? row : [];
      const n = pesajesExcelParseLocaleNumber(pesajesExcelCeldaTxt(r[c]));
      if (n == null) return;
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    });
    if (minN === Infinity) return null;
    return { min: minN, max: maxN };
  }

  function pesajesExcelCeldaTxt(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }

  /** Nombre de columna estilo Excel: 0→A, 25→Z, 26→AA … */
  function pesajesExcelColLetra(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function pesajesExcelAttachGridFilters(wrap) {
    const grid = wrap.querySelector('.pesajes-excel-grid-table');
    const countEl = wrap.querySelector('.pesajes-excel-filter-count');
    if (!grid) return;

    function nCols() {
      const firstHead = grid.querySelector('thead tr');
      if (!firstHead) return 0;
      return Math.max(0, firstHead.querySelectorAll('th.pesajes-excel-grid-colhead').length);
    }

    function apply() {
      const cols = nCols();
      const rows = grid.querySelectorAll('tbody tr');
      let visible = 0;
      let dataRowCount = 0;

      rows.forEach(function (tr) {
        if (tr.querySelector('.pesajes-excel-grid-empty')) {
          tr.style.display = '';
          return;
        }
        dataRowCount++;
        const cells = tr.querySelectorAll('td');
        let show = true;

        for (let c = 0; c < cols; c++) {
          const cellText = cells[c] ? cells[c].textContent : '';
          const sel = grid.querySelector(
            'select.pesajes-excel-col-filter--text[data-col-index="' + c + '"]'
          );
          if (sel) {
            const v = sel.value;
            if (v === '') continue;
            if (cellText !== v) {
              show = false;
              break;
            }
            continue;
          }
          const numWrap = grid.querySelector(
            '.pesajes-excel-num-range[data-col-index="' + c + '"]'
          );
          if (numWrap) {
            const minIn = numWrap.querySelector('.pesajes-excel-num-min');
            const maxIn = numWrap.querySelector('.pesajes-excel-num-max');
            const minS = minIn && minIn.value.trim();
            const maxS = maxIn && maxIn.value.trim();
            if (minS === '' && maxS === '') continue;
            const n = pesajesExcelParseLocaleNumber(cellText);
            if (n === null) {
              show = false;
              break;
            }
            if (minS !== '' && n < Number(minS)) {
              show = false;
              break;
            }
            if (maxS !== '' && n > Number(maxS)) {
              show = false;
              break;
            }
          }
        }

        tr.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      if (countEl) {
        const firstRow = rows[0];
        const isEmptyPlaceholder = firstRow && firstRow.querySelector('.pesajes-excel-grid-empty');
        if (!dataRowCount || isEmptyPlaceholder) {
          countEl.textContent = '';
        } else if (visible === dataRowCount) {
          countEl.textContent = '';
        } else {
          countEl.textContent = ' · Mostrando ' + visible + ' de ' + dataRowCount + ' filas';
        }
      }
    }

    function clearAllFilters() {
      grid.querySelectorAll('select.pesajes-excel-col-filter--text').forEach(function (s) {
        s.selectedIndex = 0;
      });
      grid.querySelectorAll('.pesajes-excel-num-min').forEach(function (i) {
        i.value = '';
      });
      grid.querySelectorAll('.pesajes-excel-num-max').forEach(function (i) {
        i.value = '';
      });
      grid.querySelectorAll('.pesajes-excel-filter-panel').forEach(function (p) {
        p.setAttribute('hidden', '');
      });
      grid.querySelectorAll('.pesajes-excel-filter-toggle').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
        b.classList.remove('is-open');
      });
      apply();
    }

    const clearBtn = wrap.querySelector('.pesajes-excel-filters-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        clearAllFilters();
      });
    }

    grid.addEventListener('click', function (e) {
      const btn = e.target.closest('.pesajes-excel-filter-toggle');
      if (!btn || !grid.contains(btn)) return;
      e.preventDefault();
      const panelId = btn.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
        panel.setAttribute('hidden', '');
      } else {
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-open');
        panel.removeAttribute('hidden');
      }
    });

    let t;
    function debouncedApply() {
      clearTimeout(t);
      t = setTimeout(apply, 80);
    }

    grid.addEventListener('change', function (e) {
      const tgt = e.target;
      if (tgt.classList && tgt.classList.contains('pesajes-excel-col-filter--text')) apply();
    });
    grid.addEventListener('input', function (e) {
      const t = e.target;
      if (
        t.classList &&
        (t.classList.contains('pesajes-excel-num-min') ||
          t.classList.contains('pesajes-excel-num-max'))
      ) {
        debouncedApply();
      }
    });
    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const el = e.target;
      if (el.classList && el.classList.contains('pesajes-excel-col-filter--text')) {
        el.selectedIndex = 0;
        apply();
        return;
      }
      if (
        el.classList &&
        (el.classList.contains('pesajes-excel-num-min') ||
          el.classList.contains('pesajes-excel-num-max'))
      ) {
        const wrapN = el.closest('.pesajes-excel-num-range');
        if (wrapN) {
          const mn = wrapN.querySelector('.pesajes-excel-num-min');
          const mx = wrapN.querySelector('.pesajes-excel-num-max');
          if (mn) mn.value = '';
          if (mx) mx.value = '';
        }
        apply();
      }
    });
  }

  function pesajesExcelRenderTablaPreview(wrap, data) {
    const esc = pesajesExcelPreviewEsc;
    const table = data.table || [];
    if (!table.length) {
      wrap.innerHTML = '<p class="residuos-section-placeholder">La primera hoja no tiene filas visibles.</p>';
      return;
    }
    const headerRow = table[0] || [];
    const nCol = Math.max(
      headerRow.length,
      table.reduce(function (m, row) {
        return Math.max(m, Array.isArray(row) ? row.length : 0);
      }, 0)
    );
    if (!nCol) {
      wrap.innerHTML = '<p class="residuos-section-placeholder">No hay columnas en la hoja.</p>';
      return;
    }
    const dataRows = table.slice(1);

    let html = '';
    html += '<div class="pesajes-excel-grid-card">';
    html += '<header class="pesajes-excel-grid-card-head">';
    html +=
      '<span class="pesajes-excel-grid-card-title">' +
      esc(data.sheetName || 'Hoja1') +
      '</span>';
    html +=
      '<span class="pesajes-excel-grid-card-meta">' +
      esc(data.rel || '') +
      '</span>';
    html += '</header>';
    html += '<div class="pesajes-excel-grid-toolbar">';
    html += '<p class="pesajes-excel-grid-leyenda">';
    html +=
      dataRows.length +
      ' fila' +
      (dataRows.length === 1 ? '' : 's') +
      ' × ' +
      nCol +
      ' columnas';
    if (data.truncated) html += ' · Vista parcial del archivo';
    if (data.truncatedCols) html += ' · columnas recortadas';
    html += '<span class="pesajes-excel-filter-count"></span>';
    html += '</p>';
    html +=
      '<button type="button" class="pesajes-excel-filters-clear" title="Quitar todos los filtros y mostrar todas las filas">Limpiar filtros</button>';
    html += '</div>';
    const colKinds = pesajesExcelInferColumnKinds(dataRows, nCol);
    html +=
      '<div class="pesajes-excel-grid-wrap tablas-raw-scroll" tabindex="0"><table class="pesajes-excel-grid-table"><thead><tr>';
    html += '<th class="pesajes-excel-grid-corner" scope="col"><span class="pesajes-excel-corner-label">#</span></th>';
    for (let c = 0; c < nCol; c++) {
      const rawTitle = pesajesExcelCeldaTxt(headerRow[c]).trim();
      const label = rawTitle || pesajesExcelColLetra(c);
      const letter = pesajesExcelColLetra(c);
      const panelId = 'pesajes-filter-c-' + c;
      html +=
        '<th scope="col" class="pesajes-excel-grid-colhead" title="Columna ' +
        esc(letter) +
        (rawTitle ? ' — ' + esc(rawTitle) : '') +
        '">';
      html += '<div class="pesajes-excel-th-head">';
      html += '<span class="pesajes-excel-th-title">' + esc(label) + '</span>';
      html +=
        '<button type="button" class="pesajes-excel-filter-toggle" aria-expanded="false" aria-controls="' +
        panelId +
        '" title="Mostrar u ocultar filtro" aria-label="Filtro: ' +
        esc(label) +
        '"><span class="pesajes-excel-filter-toggle-icon" aria-hidden="true"></span></button>';
      html += '</div>';
      html += '<div class="pesajes-excel-filter-panel" id="' + panelId + '" hidden>';
      if (colKinds[c] === 'number' && dataRows.length > 0) {
        const extent = pesajesExcelColumnNumExtent(dataRows, c);
        html +=
          '<div class="pesajes-excel-num-range" data-filter-kind="number" data-col-index="' +
          c +
          '">';
        html += '<div class="pesajes-excel-num-range-row">';
        html +=
          '<label class="pesajes-excel-num-range-label"><span class="pesajes-excel-num-range-lbl">Mín</span><input type="number" class="pesajes-excel-num-min" step="any" inputmode="decimal" placeholder="min" aria-label="Valor mínimo ' +
          esc(label) +
          '" /></label>';
        html +=
          '<label class="pesajes-excel-num-range-label"><span class="pesajes-excel-num-range-lbl">Máx</span><input type="number" class="pesajes-excel-num-max" step="any" inputmode="decimal" placeholder="max" aria-label="Valor máximo ' +
          esc(label) +
          '" /></label>';
        html += '</div>';
        if (extent) {
          html +=
            '<p class="pesajes-excel-num-hint">En datos: ' +
            esc(String(extent.min)) +
            ' … ' +
            esc(String(extent.max)) +
            '</p>';
        }
        html += '</div>';
      } else {
        const uniq = pesajesExcelColumnUniqueStrings(dataRows, c);
        html +=
          '<select class="pesajes-excel-col-filter pesajes-excel-col-filter--text" data-filter-kind="text" data-col-index="' +
          c +
          '" aria-label="Filtrar por ' +
          esc(label) +
          '">';
        html += '<option value="">Todos</option>';
        uniq.forEach(function (val) {
          html +=
            '<option value="' + pesajesExcelEscAttr(val) + '">' + esc(val) + '</option>';
        });
        html += '</select>';
      }
      html += '</div>';
      html += '</th>';
    }
    html += '</tr></thead><tbody>';
    if (!dataRows.length) {
      html +=
        '<tr><td class="pesajes-excel-grid-empty" colspan="' +
        (nCol + 1) +
        '">No hay filas de datos bajo la cabecera.</td></tr>';
    } else {
      dataRows.forEach(function (row, i) {
        const excelRow = i + 2;
        html += '<tr>';
        html += '<th scope="row" class="pesajes-excel-grid-rowhead">' + excelRow + '</th>';
        const r = Array.isArray(row) ? row : [];
        for (let c = 0; c < nCol; c++) {
          html += '<td>' + esc(pesajesExcelCeldaTxt(r[c])) + '</td>';
        }
        html += '</tr>';
      });
    }
    html += '</tbody></table></div></div>';
    wrap.innerHTML = html;
    pesajesExcelAttachGridFilters(wrap);
  }

  function pesajesExcelMostrarVistaPrevia(rel, options) {
    const wrap = document.getElementById('pesajes-excel-datos-wrap');
    if (!wrap) return;
    const esc = pesajesExcelPreviewEsc;
    const quiet = options && options.quiet;
    wrap.innerHTML =
      '<p class="tablas-raw-meta pesajes-excel-cargando">Leyendo la primera hoja del Excel…</p>';
    if (!quiet) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    fetch(dataUrl('/api/residuos/pesajes/preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: rel }),
      cache: 'no-store'
    })
      .then(async (r) => {
        let d = {};
        try {
          d = await r.json();
        } catch (e1) {
          d = { error: 'Respuesta no JSON del servidor' };
        }
        return { ok: r.ok, d };
      })
      .then(({ ok, d }) => {
        if (!ok || d.error) {
          wrap.innerHTML =
            '<p class="residuos-section-placeholder">' +
            esc(d.error || 'Error al leer el Excel') +
            '. ¿Está <code class="tablas-raw-code">npm start</code> usando la última versión del servidor? Reinicia el proceso y prueba de nuevo.</p>';
          return;
        }
        pesajesExcelRenderTablaPreview(wrap, d);
      })
      .catch(() => {
        wrap.innerHTML =
          '<p class="residuos-section-placeholder">No se pudo contactar con la API. Ejecuta <code class="tablas-raw-code">npm start</code> y recarga.</p>';
      });
  }

  /** Vista activa en la sección Tablas: 'resumen' | 'excel' */
  let tablasVistaActiva = 'resumen';
  /** Caché de todos.json (registros individuales de pesajes) */
  let _todosJsonData  = null;
  /** Página actual de la tabla raw (0-indexed) */
  let _tablaRawPage   = 0;
  const TABLA_RAW_PER_PAGE = 150;
  /** Filtros activos tabla camión */
  let _camionFiltros  = { zona: '', tipo: '', containerType: '', matricula: '' };
  /** Caché de valores únicos para filtros */
  let _camionFiltrosOpts = null;

  /** Sección Tablas: dos vistas con tabs — Resumen de todas las fuentes / Excel pesajes. */
  function updateTablasFuenteCruda() {
    const root = document.getElementById('tablas-root');
    if (!root) return;
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect  = document.getElementById('residuos-mes');
    const year = (yearSelect && yearSelect.value) || '';
    const mes  = (mesSelect  && mesSelect.value)  || '';

    const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // ── Tarjeta visual de selección ───────────────────────────
    root.innerHTML =
      '<div class="tablas-card-selector">' +
        '<div class="tablas-card' + (tablasVistaActiva === 'resumen' ? ' active' : '') + '" data-vista="resumen">' +
          '<div class="tablas-card-icon">🚛</div>' +
          '<div class="tablas-card-body">' +
            '<div class="tablas-card-title">Pesajes camión</div>' +
            '<div class="tablas-card-desc">Todos los registros RFID con zona, contenedor y coordenadas GPS</div>' +
          '</div>' +
        '</div>' +
        '<div class="tablas-card' + (tablasVistaActiva === 'excel' ? ' active' : '') + '" data-vista="excel">' +
          '<div class="tablas-card-icon">📋</div>' +
          '<div class="tablas-card-body">' +
            '<div class="tablas-card-title">Ver Excel pesajes</div>' +
            '<div class="tablas-card-desc">Archivos Excel de báscula por mes con ticket, matrícula y peso</div>' +
          '</div>' +
        '</div>' +
        '<div class="tablas-card tablas-card--informe' + (tablasVistaActiva === 'informe' ? ' active' : '') + '" data-vista="informe">' +
          '<div class="tablas-card-icon">📄</div>' +
          '<div class="tablas-card-body">' +
            '<div class="tablas-card-title">Informe mensual</div>' +
            '<div class="tablas-card-desc">Genera y descarga el informe Word del mes seleccionado</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="tablas-vista-content"></div>';

    root.querySelectorAll('.tablas-card').forEach((card) => {
      card.addEventListener('click', function () {
        tablasVistaActiva = this.dataset.vista;
        _tablaRawPage = 0;
        _camionFiltros = { zona: '', tipo: '', containerType: '', matricula: '' };
        updateTablasFuenteCruda();
      });
    });

    const content = document.getElementById('tablas-vista-content');
    if (tablasVistaActiva === 'resumen') {
      renderTablasResumen(content, year, mes, esc);
    } else if (tablasVistaActiva === 'informe') {
      renderTablasInforme(content, year, mes, esc);
    } else {
      renderTablasExcel(content, year, mes, esc);
    }
  }

  /** Tab "Ver Excel pesajes": visor del Excel del periodo seleccionado (original). */
  function renderTablasExcel(content, year, mes, esc) {
    function bindArchivoSelect(sortedFiltered, defaultRel) {
      const sel = document.getElementById('pesajes-tablas-file-select');
      if (!sel) return;
      sel.innerHTML = '';
      sortedFiltered.forEach((ex) => {
        const opt = document.createElement('option');
        opt.value = ex.rel;
        opt.textContent = ex.name || ex.rel;
        sel.appendChild(opt);
      });
      sel.value = defaultRel;
      sel.addEventListener('change', function () {
        const r = this.value;
        if (r) pesajesExcelMostrarVistaPrevia(r, { quiet: true });
      });
    }

    if (!year && !mes) {
      content.innerHTML =
        '<div class="pesajes-tablas-panel"><p class="residuos-section-placeholder pesajes-tablas-placeholder">Elige un <strong>año</strong> o un <strong>mes</strong> en la barra superior para cargar el Excel de pesajes.</p></div>';
      return;
    }

    loadPesajesExcelsList().then((result) => {
      if (!result.ok) {
        content.innerHTML =
          '<div class="pesajes-tablas-panel"><p class="residuos-section-placeholder">No se pudo cargar el listado de Excels.</p></div>';
        return;
      }
      const files = result.files;
      const filtered = files.filter((ex) => excelPesajeMatchesFiltro(ex, year, mes));
      if (!files.length) {
        content.innerHTML =
          '<div class="pesajes-tablas-panel"><p class="residuos-section-placeholder">No hay Excels en <code class="tablas-raw-code">data/RESIDUOS/pesajes/</code>.</p></div>';
        return;
      }
      if (!filtered.length) {
        content.innerHTML =
          '<div class="pesajes-tablas-panel"><p class="residuos-section-placeholder">Ningún Excel coincide con el filtro actual. Prueba otro mes o «Todo el año».</p></div>';
        return;
      }
      const sorted = pesajesExcelsSortForPeriodo(filtered);
      const defaultRel = pesajesPickDefaultRel(sorted, year, mes);
      let toolbar = '';
      if (sorted.length > 1) {
        toolbar =
          '<div class="pesajes-tablas-toolbar">' +
          '<label class="pesajes-tablas-file-label"><span class="pesajes-tablas-file-label-txt">Libro</span>' +
          '<select id="pesajes-tablas-file-select" class="pesajes-tablas-file-select" aria-label="Elegir archivo de pesajes"></select>' +
          '</label>' +
          '<span class="pesajes-tablas-toolbar-hint">' + esc(String(sorted.length)) + ' archivos en este periodo</span></div>';
      }
      content.innerHTML =
        '<div class="pesajes-tablas-panel">' +
        toolbar +
        '<div id="pesajes-excel-datos-wrap" class="pesajes-excel-datos-wrap pesajes-excel-datos-wrap--solo"></div></div>';
      if (sorted.length > 1) bindArchivoSelect(sorted, defaultRel);
      pesajesExcelMostrarVistaPrevia(defaultRel, { quiet: true });
    });
  }

  /** Tab "Pesajes camión": registros individuales del camión con filtros y paginación. */
  function renderTablasResumen(content, year, mes, esc) {
    const fmt = (n) => (n != null ? n : 0).toLocaleString('es-ES');

    function buildFilterBar(opts) {
      const mkSelect = (id, label, values, current) => {
        let s = '<select id="' + id + '" class="camion-filter-select" title="' + label + '">' +
          '<option value="">' + label + '</option>';
        values.forEach((v) => { s += '<option value="' + esc(v) + '"' + (current === v ? ' selected' : '') + '>' + esc(v) + '</option>'; });
        return s + '</select>';
      };
      return '<div class="camion-filter-bar">' +
        mkSelect('cf-zona',      'Zona',            opts.zonas,          _camionFiltros.zona) +
        mkSelect('cf-tipo',      'Tipo residuo',    opts.tipos,          _camionFiltros.tipo) +
        mkSelect('cf-container', 'Tipo contenedor', opts.containerTypes, _camionFiltros.containerType) +
        '<input id="cf-matricula" class="camion-filter-input" type="text" placeholder="Matrícula…" value="' + esc(_camionFiltros.matricula) + '">' +
        '<button id="cf-clear" class="camion-filter-clear" title="Limpiar filtros">✕ Limpiar</button>' +
      '</div>';
    }

    function bindFilterBar() {
      const applyFilters = () => {
        _camionFiltros.zona          = document.getElementById('cf-zona')?.value      || '';
        _camionFiltros.tipo          = document.getElementById('cf-tipo')?.value      || '';
        _camionFiltros.containerType = document.getElementById('cf-container')?.value || '';
        _camionFiltros.matricula     = document.getElementById('cf-matricula')?.value || '';
        _tablaRawPage = 0;
        fetchPage(0);
      };
      ['cf-zona','cf-tipo','cf-container'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', applyFilters);
      });
      let _matTimer;
      document.getElementById('cf-matricula')?.addEventListener('input', () => {
        clearTimeout(_matTimer);
        _matTimer = setTimeout(applyFilters, 400);
      });
      document.getElementById('cf-clear')?.addEventListener('click', () => {
        _camionFiltros = { zona: '', tipo: '', containerType: '', matricula: '' };
        _tablaRawPage = 0;
        fetchPage(0, true);
      });
    }

    function doRender(resp, opts) {
      const { total, page, totalPages, rows } = resp;
      const hasFilters = _camionFiltros.zona || _camionFiltros.tipo || _camionFiltros.containerType || _camionFiltros.matricula;

      let html = '<div class="tablas-raw-wrap">';

      // Barra de filtros
      if (opts) html += buildFilterBar(opts);

      // Meta + paginador
      html +=
        '<div class="tablas-resumen-meta tablas-raw-meta">' +
          '<span><strong>' + fmt(total) + '</strong> registros' +
            (year ? ' · ' + year : '') + (mes ? ' · ' + mes : '') +
            (hasFilters ? ' <span class="camion-filter-badge">filtrado</span>' : '') +
          '</span>' +
          '<div class="tablas-raw-pager">' +
            '<button class="tablas-raw-btn tablas-raw-prev"' + (page === 0 ? ' disabled' : '') + '>‹ Ant.</button>' +
            '<span class="tablas-raw-page-info">Pág. ' + (page + 1) + ' / ' + totalPages + '</span>' +
            '<button class="tablas-raw-btn tablas-raw-next"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Sig. ›</button>' +
          '</div>' +
        '</div>';

      // Tabla
      html += '<div class="tablas-resumen-scroll"><table class="tablas-resumen-table tablas-raw-table"><thead><tr>';
      html += '<th>Mes</th><th>Zona</th><th>Tipo residuo</th><th>Matrícula</th>';
      html += '<th>Tipo contenedor</th><th>Establecimiento</th>';
      html += '<th class="num">Kg</th><th class="num">Lat</th><th class="num">Lng</th>';
      html += '</tr></thead><tbody>';

      rows.forEach((r, i) => {
        const zebra = i % 2 === 0 ? '' : ' zebra';
        html += '<tr class="' + zebra + '">' +
          '<td class="mes-label"><span class="mes-chip">' + esc(r.fecha || '') + '</span></td>' +
          '<td>' + esc(r.zona  || '') + '</td>' +
          '<td>' + esc(r.tipo  || r.garbage || '') + '</td>' +
          '<td class="mat-cell">' + esc(r.matricula || '') + '</td>' +
          '<td>' + esc(r.containerType   || '') + '</td>' +
          '<td>' + esc(r.establecimiento || '') + '</td>' +
          '<td class="num kg-cell">' + (r.kg != null ? fmt(r.kg) : '<span class="sin-dato">—</span>') + '</td>' +
          '<td class="num coord-cell">' + (r.lat != null ? r.lat.toFixed(5) : '<span class="sin-dato">—</span>') + '</td>' +
          '<td class="num coord-cell">' + (r.lng != null ? r.lng.toFixed(5) : '<span class="sin-dato">—</span>') + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div></div>';

      // Si ya hay barra de filtros renderizada, preservarla
      const existingBar = content.querySelector('.camion-filter-bar');
      content.innerHTML = html;
      bindFilterBar();

      const btnPrev = content.querySelector('.tablas-raw-prev');
      const btnNext = content.querySelector('.tablas-raw-next');
      if (btnPrev) btnPrev.addEventListener('click', () => fetchPage(page - 1));
      if (btnNext) btnNext.addEventListener('click', () => fetchPage(page + 1));
    }

    function buildParams(p) {
      const params = new URLSearchParams({ page: p, perPage: TABLA_RAW_PER_PAGE });
      if (year)                          params.set('year',          year);
      if (mes)                           params.set('mes',           mes);
      if (_camionFiltros.zona)           params.set('zona',          _camionFiltros.zona);
      if (_camionFiltros.tipo)           params.set('tipo',          _camionFiltros.tipo);
      if (_camionFiltros.containerType)  params.set('containerType', _camionFiltros.containerType);
      if (_camionFiltros.matricula)      params.set('matricula',     _camionFiltros.matricula);
      return params;
    }

    function fetchPage(p, resetFilters) {
      content.innerHTML = '<div class="tablas-raw-loading">⏳ Cargando registros del camión…</div>';
      if (resetFilters) { _camionFiltros = { zona: '', tipo: '', containerType: '', matricula: '' }; }

      const fetchData = fetch('/api/residuos/camion/registros?' + buildParams(p).toString()).then((r) => r.json());

      if (_camionFiltrosOpts) {
        fetchData.then((resp) => doRender(resp, _camionFiltrosOpts)).catch(() => {
          content.innerHTML = '<p class="residuos-section-placeholder">Error cargando datos del camión.</p>';
        });
      } else {
        Promise.all([
          fetchData,
          fetch('/api/residuos/camion/filtros').then((r) => r.json())
        ]).then(([resp, opts]) => {
          _camionFiltrosOpts = opts;
          doRender(resp, opts);
        }).catch(() => {
          content.innerHTML = '<p class="residuos-section-placeholder">Error cargando datos del camión.</p>';
        });
      }
    }

    fetchPage(0);
  }

  /** Tab "Informe mensual": selección de mes y descarga directa del Word. */
  function renderTablasInforme(content, year, mes, esc) {
    const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // Construir lista de meses disponibles (de 2022 a mes actual)
    const now    = new Date();
    const maxY   = now.getFullYear();
    const maxM   = now.getMonth() + 1; // 1-based
    const meses  = [];
    for (let y = 2022; y <= maxY; y++) {
      const limM = (y === maxY) ? maxM : 12;
      for (let m = 1; m <= limM; m++) {
        const val   = y + '-' + String(m).padStart(2, '0');
        const label = MESES_ES[m - 1] + ' ' + y;
        meses.unshift({ val, label }); // más reciente primero
      }
    }

    // Mes seleccionado: preferimos el selector global, o el más reciente
    let mesSel = mes || (meses[0] ? meses[0].val : '');

    function buildHTML(selMes, estado) {
      const labelSel = meses.find((m) => m.val === selMes)?.label || selMes || '—';
      let estadoHTML = '';
      if (estado === 'loading') {
        estadoHTML = '<div class="informe-estado informe-estado--loading">⏳ Generando informe, por favor espera…</div>';
      } else if (estado === 'error') {
        estadoHTML = '<div class="informe-estado informe-estado--error">❌ Error al generar el informe. Comprueba que el servidor está activo e inténtalo de nuevo.</div>';
      }

      const optsHTML = meses.map((m) =>
        '<option value="' + m.val + '"' + (m.val === selMes ? ' selected' : '') + '>' + m.label + '</option>'
      ).join('');

      return (
        '<div class="informe-panel">' +
          '<div class="informe-panel-header">' +
            '<span class="informe-panel-icon">📄</span>' +
            '<div>' +
              '<div class="informe-panel-title">Informe mensual de residuos</div>' +
              '<div class="informe-panel-subtitle">Selecciona el mes y descarga el informe Word (.docx) con portada, tablas y conclusiones</div>' +
            '</div>' +
          '</div>' +
          '<div class="informe-panel-form">' +
            '<label class="informe-label">Mes del informe</label>' +
            '<select id="informe-mes-select" class="informe-mes-select">' + optsHTML + '</select>' +
            '<button id="informe-descargar-btn" class="informe-descargar-btn">' +
              '<span class="informe-btn-icon">⬇️</span> Descargar informe Word' +
            '</button>' +
          '</div>' +
          estadoHTML +
          '<div class="informe-panel-info">' +
            '<span class="informe-info-item">📊 Datos del camión RFID</span>' +
            '<span class="informe-info-sep">·</span>' +
            '<span class="informe-info-item">🏨 Ranking hoteles</span>' +
            '<span class="informe-info-sep">·</span>' +
            '<span class="informe-info-item">🗂️ Zonas y contenedores</span>' +
            '<span class="informe-info-sep">·</span>' +
            '<span class="informe-info-item">📈 Comparación anual</span>' +
          '</div>' +
        '</div>'
      );
    }

    content.innerHTML = buildHTML(mesSel, null);

    function bindBtn(selMes, estado) {
      const btn = document.getElementById('informe-descargar-btn');
      const sel = document.getElementById('informe-mes-select');
      if (sel) {
        sel.addEventListener('change', function () {
          mesSel = this.value;
          content.innerHTML = buildHTML(mesSel, null);
          bindBtn(mesSel, null);
        });
      }
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (!mesSel) return;
        // Mostrar estado loading
        content.innerHTML = buildHTML(mesSel, 'loading');
        bindBtn(mesSel, 'loading');
        // Disparar descarga directa vía enlace oculto
        const url = '/api/residuos/descargar-informe?mes=' + encodeURIComponent(mesSel);
        // Verificar que la respuesta es ok antes de abrir
        fetch(url, { method: 'GET' })
          .then((r) => {
            if (!r.ok) throw new Error('Error ' + r.status);
            return r.blob();
          })
          .then((blob) => {
            const a    = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            const nom  = meses.find((m) => m.val === mesSel)?.label || mesSel;
            a.download = 'Informe_Residuos_' + nom.replace(/\s+/g, '_') + '.docx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            content.innerHTML = buildHTML(mesSel, null);
            bindBtn(mesSel, null);
          })
          .catch(() => {
            content.innerHTML = buildHTML(mesSel, 'error');
            bindBtn(mesSel, 'error');
          });
      });
    }

    bindBtn(mesSel, null);
  }

  window.toggleDashboardMode = function (target) {
    if (target && ['camaras', 'residuos', 'turismo'].indexOf(target) >= 0) { setMode(target); return; }
    const next = mode === 'camaras' ? 'residuos' : mode === 'residuos' ? 'turismo' : 'camaras';
    setMode(next);
  };
  function wireModeButtons() {
    document.querySelectorAll('#mode-switcher .mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const target = btn.getAttribute('data-target');
        if (target) window.toggleDashboardMode(target);
      });
    });
  }

  function initResiduos() {
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const reloadBtn = document.getElementById('residuos-reload');
    wireModeButtons();
    ['mapa-filter-matricula', 'mapa-filter-garbage', 'mapa-filter-container'].forEach((fid) => {
      const el = document.getElementById(fid);
      if (el) {
        el.addEventListener('change', function () {
          const sec = document.getElementById('section-mapa');
          if (sec && sec.classList.contains('active') && residuosMainVisible()) setTimeout(initMapaResiduos, 0);
        });
      }
    });
    const zonasSlicer = document.getElementById('zonas-slicer-zona');
    if (zonasSlicer) {
      zonasSlicer.addEventListener('change', function () {
        updateZonasTabKpiAndChart();
        syncMapaZonasIfNeeded();
      });
    }
    loadAllData()
      .catch(function () {})
      .then(function () {
        return loadPesajesExcelsList();
      })
      .then(function () {
      const years = getResiduosYears();
      if (yearSelect) {
        yearSelect.innerHTML = '';
        yearSelect.appendChild(new Option('Todos los años', ''));
        years.forEach((y) => yearSelect.appendChild(new Option(y, y)));
        if (years.length) yearSelect.value = years[years.length - 1];
      }
      if (mesSelect) {
        mesSelect.innerHTML = '';
        var y0 = (yearSelect && yearSelect.value) || '';
        mesSelect.appendChild(new Option(y0 ? 'Todo el año' : 'Todos los meses', ''));
        const months = getResiduosMonths(y0);
        months.forEach((m) => { const mm = m.split('-')[1]; mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m)); });
        if (months.length) mesSelect.value = months[months.length - 1];
      }
      if (yearSelect) {
        yearSelect.addEventListener('change', () => {
          const y = yearSelect.value;
          mesSelect.innerHTML = '';
          mesSelect.appendChild(new Option(y ? 'Todo el año' : 'Todos los meses', ''));
          const months = getResiduosMonths(y);
          months.forEach((m) => {
            const mm = m.split('-')[1];
            mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m));
          });
          if (months.length) mesSelect.value = months[months.length - 1];
          syncMesSelectWithMapaData().then(() => updateResiduosKPIs());
        });
      }
      if (mesSelect) mesSelect.addEventListener('change', updateResiduosKPIs);
      const cmp = document.getElementById('residuos-compare');
      if (cmp) cmp.addEventListener('change', updateResiduosKPIs);
      syncMesSelectWithMapaData().then(() => {
        if (residuosMainVisible()) updateResiduosKPIs();
      });
    }).catch(() => { if (yearSelect) yearSelect.innerHTML = '<option value="">Sin datos</option>'; if (mesSelect) mesSelect.innerHTML = '<option value="">Sin datos</option>'; });
    if (reloadBtn) reloadBtn.addEventListener('click', () => loadAllData().then(() => {
      mapaResiduosGeoCache = null;
      zonasGeojsonCache = null;
      invalidatePesajesExcelsList();
      return loadPesajesExcelsList();
    }).then(() => {
      const years = getResiduosYears();
      if (yearSelect && years.length) {
        yearSelect.innerHTML = '';
        yearSelect.appendChild(new Option('Todos los años', ''));
        years.forEach((y) => yearSelect.appendChild(new Option(y, y)));
        yearSelect.value = years[years.length - 1];
      } else if (yearSelect) {
        yearSelect.innerHTML = '';
        yearSelect.appendChild(new Option('Todos los años', ''));
      }
      if (mesSelect && yearSelect) {
        const y = yearSelect.value;
        mesSelect.innerHTML = '';
        mesSelect.appendChild(new Option(y ? 'Todo el año' : 'Todos los meses', ''));
        const months = getResiduosMonths(y);
        months.forEach((m) => { const mm = m.split('-')[1]; mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m)); });
        if (months.length) mesSelect.value = months[months.length - 1];
      }
      syncMesSelectWithMapaData().then(() => updateResiduosKPIs());
    }));
    document.querySelectorAll('#nav-residuos .nav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#nav-residuos .nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#main-residuos .section').forEach((s) => s.classList.remove('active'));
        const sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
        const headerR = document.getElementById('header-residuos');
        const h2R = headerR && headerR.querySelector('h2');
        const residTitles = {
          kpis: 'Residuos - KPIs',
          reciclaje: 'Residuos - Tipos (reciclaje)',
          hoteles: 'Residuos - Hoteles y campings',
          mapa: 'Residuos - Mapa de contenedores',
          zonas: 'Residuos - Por zonas',
          'comparacion-tipos': 'Residuos - Comparación por tipo',
          tablas: 'Residuos - Tablas'
        };
        if (h2R && residTitles[el.dataset.section]) h2R.textContent = residTitles[el.dataset.section];
        setTimeout(function () { updateResiduosKPIs(); }, 100);
      });
    });
  }

  function initCamarasTrafico() {
    const mesSelect = document.getElementById('trafico-mes-select');
    const camaraSelect = document.getElementById('trafico-camara-select');
    const fechaSelect = document.getElementById('trafico-fecha-select');
    if (mesSelect) {
      mesSelect.innerHTML = '<option value="">Todas</option>';
      const es = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {};
      const meses = Object.keys(es).sort();
      meses.forEach((m) => { mesSelect.appendChild(new Option(MESES[parseInt(m.slice(5), 10) - 1] || m, m)); });
      mesSelect.addEventListener('change', updateTraficoDashboard);
    }
    if (camaraSelect) {
      camaraSelect.innerHTML = '<option value="">Todas</option>';
      const byCamara = (camarasData && camarasData.lpr && camarasData.lpr.byCamara) || {};
      Object.keys(byCamara).sort().forEach((c) => camaraSelect.appendChild(new Option(c, c)));
    }
    if (fechaSelect) {
      fechaSelect.innerHTML = '<option value="">Todas</option>';
      const esDia = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorDia) || {};
      Object.keys(esDia).sort().forEach((d) => fechaSelect.appendChild(new Option(d, d)));
      fechaSelect.addEventListener('change', updateTraficoDashboard);
    }
  }

  // ============================================================
  // Módulo TURISMO — datos INE (hoteles, apartamentos, campings)
  // ============================================================
  let turismoData = null;
  let turismoLoading = null;
  const turismoCharts = {};
  const TURISMO_COLORS = {
    hoteles: '#2563eb',
    apartamentos: '#0891b2',
    campings: '#d97706',
    espana: '#2563eb',
    extranjero: '#059669',
    pernoctaciones: '#1d4ed8',
    grad: ['#2563eb', '#059669', '#d97706', '#0891b2', '#7c3aed', '#e11d48'],
  };
  const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function tFmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(Number(n)).toLocaleString('es-ES');
  }
  function tFmtDec(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-ES', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 1 });
  }
  function tFmtPct(n) {
    if (n == null || isNaN(n) || !isFinite(n)) return '—';
    const s = (n > 0 ? '+' : '') + Number(n).toFixed(1).replace('.', ',') + '%';
    return s;
  }
  function variacionPctTurismo(act, prev) {
    if (!prev || prev === 0 || act == null || prev == null) return null;
    return ((act - prev) / prev) * 100;
  }
  function fechaLabelTurismo(fecha) {
    const m = /^(\d{4})-(\d{2})$/.exec(fecha || '');
    if (!m) return fecha || '—';
    return `${MESES_CORTOS[+m[2] - 1]} ${m[1]}`;
  }

  function ensureTurismoLoaded() {
    if (turismoData) return Promise.resolve(turismoData);
    if (turismoLoading) return turismoLoading;
    const url = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/todos.json') : '/data/TURISMO/todos.json';
    turismoLoading = fetch(url, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('TURISMO no disponible'); return r.json(); })
      .then((d) => { turismoData = d; populateTurismoFilters(); return d; })
      .catch((e) => {
        const title = document.getElementById('turismo-hero-title');
        const sub = document.getElementById('turismo-hero-sub');
        if (title) title.textContent = 'No hay datos descargados todavía';
        if (sub) sub.textContent = 'Pulsa "Actualizar INE" para descargar las series.';
        throw e;
      });
    return turismoLoading;
  }

  function populateTurismoFilters() {
    const yearSelect = document.getElementById('turismo-year');
    if (!yearSelect || !turismoData) return;
    const years = new Set();
    ['hoteles', 'apartamentos', 'campings'].forEach((cat) => {
      (turismoData.series[cat] || []).forEach((s) => (s.data || []).forEach((d) => years.add(d.anyo)));
    });
    const sorted = Array.from(years).sort((a, b) => a - b);
    yearSelect.innerHTML = '';
    yearSelect.appendChild(new Option('Todos los años', ''));
    sorted.forEach((y) => yearSelect.appendChild(new Option(y, y)));
    if (sorted.length) yearSelect.value = sorted[sorted.length - 1];
  }

  function getTurismoYear() {
    const sel = document.getElementById('turismo-year');
    return sel && sel.value ? sel.value : '';
  }
  function getTurismoMes() {
    const sel = document.getElementById('turismo-mes');
    return sel && sel.value ? parseInt(sel.value, 10) : null;
  }

  function destroyTurismoChart(key) {
    if (turismoCharts[key]) { try { turismoCharts[key].destroy(); } catch (_) {} turismoCharts[key] = null; }
  }

  function turismoChartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#0f172a', font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#ffffff',
          titleColor: '#0f172a',
          bodyColor: '#0f172a',
          borderColor: '#cbd5e1',
          borderWidth: 1,
          padding: 10,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${tFmtNum(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed)}` }
        }
      },
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(226, 232, 240, 0.7)' } },
        y: { ticks: { color: '#64748b', callback: (v) => tFmtNum(v) }, grid: { color: 'rgba(226, 232, 240, 0.7)' } }
      }
    };
  }

  function turismoSeriesPorMes(series, filtro) {
    const map = {};
    series.filter((s) => (!filtro.metrica || s.metrica === filtro.metrica) && (!filtro.residencia || s.residencia === filtro.residencia))
      .forEach((s) => (s.data || []).forEach((d) => {
        if (filtro.anyo && String(d.anyo) !== String(filtro.anyo)) return;
        if (filtro.mes && d.mes !== filtro.mes) return;
        map[d.fecha] = (map[d.fecha] || 0) + d.valor;
      }));
    return map;
  }

  function actualizarHeroTurismo() {
    if (!turismoData) return;
    const r = turismoData.resumen || {};
    const meses = [r.hoteles?.ultimoMes, r.apartamentos?.ultimoMes, r.campings?.ultimoMes].filter(Boolean).sort();
    const ultimo = meses[meses.length - 1];
    const titulo = document.getElementById('turismo-hero-title');
    const sub = document.getElementById('turismo-hero-sub');
    const heroMes = document.getElementById('turismo-hero-mes');
    const heroUpd = document.getElementById('turismo-hero-update');
    if (titulo) titulo.textContent = 'Turismo en Peñíscola';
    if (sub) sub.textContent = 'Hoteles, apartamentos y campings · datos oficiales del INE';
    if (heroMes) heroMes.textContent = ultimo ? fechaLabelTurismo(ultimo) : '—';
    if (heroUpd) heroUpd.textContent = 'Actualizado: ' + new Date(turismoData.generadoEn || Date.now()).toLocaleString('es-ES');
  }

  function renderTurismoKPIs() {
    if (!turismoData) return;
    const r = turismoData.resumen || {};
    const cats = [
      { key: 'hoteles', viaj: 'turismo-kpi-hoteles-viajeros', viajSub: 'turismo-kpi-hoteles-viajeros-sub', pern: 'turismo-kpi-hoteles-pern', pernSub: 'turismo-kpi-hoteles-pern-sub' },
      { key: 'apartamentos', viaj: 'turismo-kpi-apart-viajeros', viajSub: 'turismo-kpi-apart-viajeros-sub', pern: 'turismo-kpi-apart-pern', pernSub: 'turismo-kpi-apart-pern-sub', anyo: 'turismo-kpi-apart-anyo', anyoSub: 'turismo-kpi-apart-anyo-sub' },
      { key: 'campings', viaj: 'turismo-kpi-camp-viajeros', viajSub: 'turismo-kpi-camp-viajeros-sub', pern: 'turismo-kpi-camp-pern', pernSub: 'turismo-kpi-camp-pern-sub', anyo: 'turismo-kpi-camp-anyo', anyoSub: 'turismo-kpi-camp-anyo-sub' }
    ];
    cats.forEach((c) => {
      const d = r[c.key] || {};
      const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
      setText(c.viaj, tFmtNum(d.viajerosUltimo));
      setText(c.pern, tFmtNum(d.pernoctacionesUltimo));
      setText(c.viajSub, d.ultimoMes ? fechaLabelTurismo(d.ultimoMes) : '—');
      setText(c.pernSub, d.ultimoMes ? fechaLabelTurismo(d.ultimoMes) : '—');
      if (c.anyo) {
        setText(c.anyo, tFmtNum(d.totalPernoctacionesAnyo));
        const pct = variacionPctTurismo(d.totalPernoctacionesAnyo, d.totalPernoctacionesAnyoAnterior);
        const sub = document.getElementById(c.anyoSub);
        if (sub) {
          sub.textContent = 'vs ' + tFmtNum(d.totalPernoctacionesAnyoAnterior) + ' año anterior · ' + tFmtPct(pct);
          sub.classList.remove('up', 'down');
          if (pct != null) sub.classList.add(pct >= 0 ? 'up' : 'down');
        }
      }
    });
    const est = (turismoData.series.hoteles || []).find((s) => s.metrica === 'estancia_media');
    const elEst = document.getElementById('turismo-kpi-hoteles-estancia');
    if (elEst) {
      const data = est?.data || [];
      const last = data[data.length - 1];
      elEst.textContent = last ? tFmtDec(last.valor, 2) : '—';
    }
  }

  function renderTurismoResumenCharts() {
    if (!turismoData) return;
    const cats = ['hoteles', 'apartamentos', 'campings'];
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const labelsSet = new Set();
    const porCatPern = {};
    cats.forEach((cat) => {
      const m = turismoSeriesPorMes(turismoData.series[cat] || [], { metrica: 'pernoctaciones', anyo: year, mes });
      porCatPern[cat] = m;
      Object.keys(m).forEach((k) => labelsSet.add(k));
    });
    const labels = Array.from(labelsSet).sort();
    destroyTurismoChart('resumen-mes');
    const ctxA = document.getElementById('chart-turismo-resumen-mes');
    if (ctxA) {
      turismoCharts['resumen-mes'] = new Chart(ctxA, {
        type: 'bar',
        data: {
          labels: labels.map(fechaLabelTurismo),
          datasets: cats.map((cat) => ({
            label: cat[0].toUpperCase() + cat.slice(1),
            data: labels.map((f) => porCatPern[cat][f] || 0),
            backgroundColor: TURISMO_COLORS[cat],
            borderRadius: 4,
            stack: 'pern'
          }))
        },
        options: { ...turismoChartDefaults(), scales: { ...turismoChartDefaults().scales, x: { ...turismoChartDefaults().scales.x, stacked: true }, y: { ...turismoChartDefaults().scales.y, stacked: true } } }
      });
    }
    const totals = cats.map((cat) => Object.values(porCatPern[cat]).reduce((a, b) => a + b, 0));
    destroyTurismoChart('resumen-tipo');
    const ctxB = document.getElementById('chart-turismo-resumen-tipo');
    if (ctxB) {
      turismoCharts['resumen-tipo'] = new Chart(ctxB, {
        type: 'doughnut',
        data: { labels: ['Hoteles', 'Apartamentos', 'Campings'], datasets: [{ data: totals, backgroundColor: cats.map((c) => TURISMO_COLORS[c]), borderColor: '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
      });
    }
    let totEsp = 0, totExt = 0;
    cats.forEach((cat) => {
      (turismoData.series[cat] || []).forEach((s) => {
        if (s.metrica !== 'pernoctaciones') return;
        const sum = (s.data || []).filter((d) => (!year || String(d.anyo) === String(year)) && (!mes || d.mes === mes)).reduce((a, b) => a + b.valor, 0);
        if (s.residencia === 'espana') totEsp += sum;
        else if (s.residencia === 'extranjero') totExt += sum;
      });
    });
    destroyTurismoChart('origen');
    const ctxC = document.getElementById('chart-turismo-origen');
    if (ctxC) {
      turismoCharts['origen'] = new Chart(ctxC, {
        type: 'doughnut',
        data: { labels: ['Residentes en España', 'Residentes en extranjero'], datasets: [{ data: [totEsp, totExt], backgroundColor: [TURISMO_COLORS.espana, TURISMO_COLORS.extranjero], borderColor: '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
      });
    }
    const sumByMonth = Array(12).fill(0);
    const countByMonth = Array(12).fill(0);
    cats.forEach((cat) => {
      (turismoData.series[cat] || []).forEach((s) => {
        if (s.metrica !== 'pernoctaciones') return;
        (s.data || []).forEach((d) => {
          if (!d.mes) return;
          sumByMonth[d.mes - 1] += d.valor;
          countByMonth[d.mes - 1] += 1;
        });
      });
    });
    const avgByMonth = sumByMonth.map((s, i) => countByMonth[i] ? s / countByMonth[i] : 0);
    destroyTurismoChart('estacionalidad');
    const ctxD = document.getElementById('chart-turismo-estacionalidad');
    if (ctxD) {
      turismoCharts['estacionalidad'] = new Chart(ctxD, {
        type: 'line',
        data: { labels: MESES_CORTOS, datasets: [{ label: 'Pernoctaciones medias', data: avgByMonth, borderColor: TURISMO_COLORS.hoteles, backgroundColor: 'rgba(37, 99, 235, 0.15)', fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: TURISMO_COLORS.hoteles }] },
        options: turismoChartDefaults()
      });
    }
  }

  function renderTurismoMiniKpis(cat, containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    const res = (turismoData?.resumen || {})[cat] || {};
    const pct = variacionPctTurismo(res.totalPernoctacionesAnyo, res.totalPernoctacionesAnyoAnterior);
    const items = [
      { label: 'Último mes', value: res.ultimoMes ? fechaLabelTurismo(res.ultimoMes) : '—', sub: '' },
      { label: 'Viajeros (mes)', value: tFmtNum(res.viajerosUltimo), sub: '' },
      { label: 'Pernoctaciones (mes)', value: tFmtNum(res.pernoctacionesUltimo), sub: '' },
      { label: 'Acumulado año', value: tFmtNum(res.totalPernoctacionesAnyo), sub: 'vs ' + tFmtNum(res.totalPernoctacionesAnyoAnterior), subClass: pct == null ? '' : (pct >= 0 ? 'up' : 'down'), subValor: pct == null ? '' : ' (' + tFmtPct(pct) + ')' }
    ];
    cont.innerHTML = items.map((it) => `<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">${it.label}</span><span class="turismo-mini-kpi-value">${it.value}</span>${it.sub ? `<span class="turismo-mini-kpi-sub ${it.subClass || ''}">${it.sub}${it.subValor || ''}</span>` : ''}</div>`).join('');
  }

  function renderTurismoCategoriaMesChart(canvasId, cat) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    destroyTurismoChart(canvasId);
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const series = turismoData.series[cat] || [];
    if (!series.length || !series.some((s) => (s.data || []).length)) {
      ctx.parentElement.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Sin datos publicados.</p>';
      return;
    }
    const viajEsp = turismoSeriesPorMes(series, { metrica: 'viajeros', residencia: 'espana', anyo: year, mes });
    const viajExt = turismoSeriesPorMes(series, { metrica: 'viajeros', residencia: 'extranjero', anyo: year, mes });
    const pernEsp = turismoSeriesPorMes(series, { metrica: 'pernoctaciones', residencia: 'espana', anyo: year, mes });
    const pernExt = turismoSeriesPorMes(series, { metrica: 'pernoctaciones', residencia: 'extranjero', anyo: year, mes });
    const all = new Set([...Object.keys(viajEsp), ...Object.keys(viajExt), ...Object.keys(pernEsp), ...Object.keys(pernExt)]);
    const labels = Array.from(all).sort();
    turismoCharts[canvasId] = new Chart(ctx, {
      data: {
        labels: labels.map(fechaLabelTurismo),
        datasets: [
          { type: 'bar', label: 'Viajeros España', data: labels.map((f) => viajEsp[f] || 0), backgroundColor: TURISMO_COLORS.espana, stack: 'viaj', borderRadius: 3, yAxisID: 'y' },
          { type: 'bar', label: 'Viajeros Extranjero', data: labels.map((f) => viajExt[f] || 0), backgroundColor: TURISMO_COLORS.extranjero, stack: 'viaj', borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Pernoctaciones', data: labels.map((f) => (pernEsp[f] || 0) + (pernExt[f] || 0)), borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.15)', tension: 0.35, fill: false, pointRadius: 3, yAxisID: 'y1' }
        ]
      },
      options: {
        ...turismoChartDefaults(),
        scales: {
          x: turismoChartDefaults().scales.x,
          y: { ...turismoChartDefaults().scales.y, title: { display: true, text: 'Viajeros', color: '#8b949e' } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: '#8b949e', callback: (v) => tFmtNum(v) }, title: { display: true, text: 'Pernoctaciones', color: '#8b949e' } }
        }
      }
    });
  }

  function renderTurismoCategoriaOrigenChart(canvasId, cat) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    destroyTurismoChart(canvasId);
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const series = turismoData.series[cat] || [];
    const sumE = Object.values(turismoSeriesPorMes(series, { metrica: 'pernoctaciones', residencia: 'espana', anyo: year, mes })).reduce((a, b) => a + b, 0);
    const sumX = Object.values(turismoSeriesPorMes(series, { metrica: 'pernoctaciones', residencia: 'extranjero', anyo: year, mes })).reduce((a, b) => a + b, 0);
    if (sumE + sumX === 0) {
      ctx.parentElement.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Sin datos publicados.</p>';
      return;
    }
    turismoCharts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Residentes en España', 'Residentes en extranjero'], datasets: [{ data: [sumE, sumX], backgroundColor: [TURISMO_COLORS.espana, TURISMO_COLORS.extranjero], borderColor: '#ffffff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
    });
  }

  function renderTurismoCategoriaAnualChart(canvasId, cat) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    destroyTurismoChart(canvasId);
    const series = turismoData.series[cat] || [];
    const pern = series.filter((s) => s.metrica === 'pernoctaciones');
    if (!pern.length || !pern.some((s) => (s.data || []).length)) {
      ctx.parentElement.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Sin datos publicados.</p>';
      return;
    }
    const porAnyo = {};
    pern.forEach((s) => (s.data || []).forEach((d) => {
      if (!d.mes) return;
      if (!porAnyo[d.anyo]) porAnyo[d.anyo] = Array(12).fill(0);
      porAnyo[d.anyo][d.mes - 1] += d.valor;
    }));
    const anyos = Object.keys(porAnyo).sort();
    const palette = ['#f97316', '#ec4899', '#0ea5e9', '#facc15', '#14b8a6', '#7c3aed', '#22c55e', '#a855f7', '#06b6d4'];
    turismoCharts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: MESES_CORTOS,
        datasets: anyos.map((y, i) => ({
          label: String(y),
          data: porAnyo[y],
          borderColor: palette[i % palette.length],
          backgroundColor: palette[i % palette.length] + '22',
          tension: 0.3,
          fill: false,
          pointRadius: 3
        }))
      },
      options: turismoChartDefaults()
    });
  }

  function renderTurismoApartamentos() {
    const empty = document.getElementById('turismo-apart-empty');
    const charts = document.getElementById('turismo-apart-charts');
    const hayDatos = (turismoData.series.apartamentos || []).some((s) => (s.data || []).length);
    if (!hayDatos) {
      if (empty) empty.style.display = 'flex';
      if (charts) charts.style.display = 'none';
    } else {
      if (empty) empty.style.display = 'none';
      if (charts) charts.style.display = 'grid';
      renderTurismoCategoriaMesChart('chart-turismo-apart-mes', 'apartamentos');
      renderTurismoCategoriaOrigenChart('chart-turismo-apart-origen', 'apartamentos');
    }
  }

  function renderTurismoComparativa() {
    const cats = ['hoteles', 'apartamentos', 'campings'];
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const labelsSet = new Set();
    const dataViaj = {};
    const dataPern = {};
    cats.forEach((cat) => {
      dataViaj[cat] = turismoSeriesPorMes(turismoData.series[cat] || [], { metrica: 'viajeros', anyo: year, mes });
      dataPern[cat] = turismoSeriesPorMes(turismoData.series[cat] || [], { metrica: 'pernoctaciones', anyo: year, mes });
      Object.keys(dataViaj[cat]).forEach((k) => labelsSet.add(k));
      Object.keys(dataPern[cat]).forEach((k) => labelsSet.add(k));
    });
    const labels = Array.from(labelsSet).sort();
    const buildDatasets = (mapas) => cats.map((cat) => ({
      label: cat[0].toUpperCase() + cat.slice(1),
      data: labels.map((f) => mapas[cat][f] || 0),
      borderColor: TURISMO_COLORS[cat], backgroundColor: TURISMO_COLORS[cat] + '33',
      fill: false, tension: 0.3, pointRadius: 3
    }));
    destroyTurismoChart('comp-viajeros');
    const ctxV = document.getElementById('chart-turismo-comp-viajeros');
    if (ctxV) turismoCharts['comp-viajeros'] = new Chart(ctxV, { type: 'line', data: { labels: labels.map(fechaLabelTurismo), datasets: buildDatasets(dataViaj) }, options: turismoChartDefaults() });
    destroyTurismoChart('comp-pern');
    const ctxP = document.getElementById('chart-turismo-comp-pern');
    if (ctxP) turismoCharts['comp-pern'] = new Chart(ctxP, { type: 'line', data: { labels: labels.map(fechaLabelTurismo), datasets: buildDatasets(dataPern) }, options: turismoChartDefaults() });
    const totals = cats.map((c) => Object.values(dataPern[c]).reduce((a, b) => a + b, 0));
    destroyTurismoChart('comp-reparto');
    const ctxR = document.getElementById('chart-turismo-comp-reparto');
    if (ctxR) turismoCharts['comp-reparto'] = new Chart(ctxR, { type: 'doughnut', data: { labels: ['Hoteles', 'Apartamentos', 'Campings'], datasets: [{ data: totals, backgroundColor: cats.map((c) => TURISMO_COLORS[c]), borderColor: '#ffffff', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } } });
    const r = turismoData.resumen || {};
    const actuales = cats.map((c) => (r[c]?.totalPernoctacionesAnyo) || 0);
    const previos = cats.map((c) => (r[c]?.totalPernoctacionesAnyoAnterior) || 0);
    destroyTurismoChart('comp-anio');
    const ctxA = document.getElementById('chart-turismo-comp-anio');
    if (ctxA) turismoCharts['comp-anio'] = new Chart(ctxA, {
      type: 'bar',
      data: { labels: ['Hoteles', 'Apartamentos', 'Campings'], datasets: [
        { label: 'Año actual', data: actuales, backgroundColor: TURISMO_COLORS.hoteles, borderRadius: 4 },
        { label: 'Año anterior', data: previos, backgroundColor: '#8b949e', borderRadius: 4 }
      ] },
      options: turismoChartDefaults()
    });
  }

  function renderTurismoTablas() {
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const buildTable = (cat) => {
      const series = turismoData.series[cat] || [];
      if (!series.length || !series.some((s) => (s.data || []).length)) return '<p style="padding:0.5rem;color:var(--text-muted)">Sin datos publicados por el INE.</p>';
      const fechas = new Set();
      series.forEach((s) => (s.data || []).forEach((d) => { if ((!year || String(d.anyo) === String(year)) && (!mes || d.mes === mes)) fechas.add(d.fecha); }));
      const orderedFechas = Array.from(fechas).sort().reverse();
      const cols = series.map((s) => ({ s, key: `${s.metrica}-${s.residencia}` }));
      const head = '<tr><th>Mes</th>' + cols.map((c) => `<th>${c.s.metrica} (${c.s.residencia})</th>`).join('') + '</tr>';
      const rows = orderedFechas.map((f) => {
        const tds = cols.map((c) => {
          const dat = (c.s.data || []).find((d) => d.fecha === f);
          return `<td>${dat ? tFmtNum(dat.valor) : '—'}</td>`;
        }).join('');
        return `<tr><td>${fechaLabelTurismo(f)}</td>${tds}</tr>`;
      }).join('');
      return `<table class="data-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    };
    const elH = document.getElementById('turismo-tabla-hoteles');
    const elA = document.getElementById('turismo-tabla-apartamentos');
    const elC = document.getElementById('turismo-tabla-campings');
    if (elH) elH.innerHTML = buildTable('hoteles');
    if (elA) elA.innerHTML = buildTable('apartamentos');
    if (elC) elC.innerHTML = buildTable('campings');
    const tag = document.getElementById('turismo-tablas-tag');
    if (tag) tag.textContent = year ? `Año ${year}` : 'Todos los años';
  }

  function renderTurismoContextRow() {
    if (!turismoData) return;
    const r = turismoData.resumen || {};
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    // Padrón
    if (r.padron) {
      setText('turismo-ctx-habitantes', tFmtNum(r.padron.poblacion));
      setText('turismo-ctx-habitantes-sub', 'Padrón ' + r.padron.ultimoAnyo);
    }
    // Movilidad turistas extranjeros
    if (r.movilidad && r.movilidad.turistasUltimo != null) {
      setText('turismo-ctx-turistas', tFmtNum(r.movilidad.turistasUltimo));
      setText('turismo-ctx-turistas-sub', r.movilidad.ultimoMes ? fechaLabelTurismo(r.movilidad.ultimoMes) + ' · INE móvil' : 'INE móvil');
    }
    // Presión turística
    if (r.presionTuristica) {
      setText('turismo-ctx-presion', tFmtNum(r.presionTuristica.ratio_por_1000_habitantes));
    }
    // Campings: plazas + establecimientos
    if (r.campings) {
      if (r.campings.ultimasPlazas != null) setText('turismo-ctx-plazas', tFmtNum(r.campings.ultimasPlazas));
      if (r.campings.ultimosEstablecimientos != null) setText('turismo-ctx-plazas-sub', r.campings.ultimosEstablecimientos + ' establecimientos · ' + (r.campings.ultimoGradoOcupacion != null ? r.campings.ultimoGradoOcupacion.toFixed(0).replace('.', ',') + '% ocup.' : '—'));
    }
  }

  // ====== Movilidad / TMOV ======
  function renderTurismoMovilidad() {
    if (!turismoData) return;
    const movil = turismoData.series.movilidad || [];
    const r = turismoData.resumen.movilidad || {};
    // Mini KPIs
    const cont = document.getElementById('turismo-mini-movilidad');
    if (cont) {
      const pct = variacionPctTurismo(r.totalTuristasAnyo, r.totalTuristasAnyoAnterior);
      cont.innerHTML = [
        { l: 'Último mes', v: r.ultimoMes ? fechaLabelTurismo(r.ultimoMes) : '—' },
        { l: 'Turistas extranjeros', v: tFmtNum(r.turistasUltimo) },
        { l: 'Acumulado año', v: tFmtNum(r.totalTuristasAnyo), sub: 'vs ' + tFmtNum(r.totalTuristasAnyoAnterior), subClass: pct == null ? '' : (pct >= 0 ? 'up' : 'down'), subValor: pct == null ? '' : ' (' + tFmtPct(pct) + ')' },
        { l: 'Top país (12 m)', v: r.topPaises && r.topPaises[0] ? r.topPaises[0].pais : '—', sub: r.topPaises && r.topPaises[0] ? tFmtNum(r.topPaises[0].total) + ' turistas' : '' }
      ].map((it) => `<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">${it.l}</span><span class="turismo-mini-kpi-value">${it.v}</span>${it.sub ? `<span class="turismo-mini-kpi-sub ${it.subClass || ''}">${it.sub}${it.subValor || ''}</span>` : ''}</div>`).join('');
    }

    // Chart por mes (total) — fallback al histórico completo si el filtro deja vacío
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const total = movil.find((s) => s.residencia === 'total');
    destroyTurismoChart('mov-mes');
    const ctxA = document.getElementById('chart-turismo-mov-mes');
    if (ctxA && total) {
      const todos = total.data || [];
      let dataFiltered = todos.filter((d) => (!year || String(d.anyo) === String(year)) && (!mes || d.mes === mes));
      // Si el año/mes seleccionado no tiene datos TMOV, mostramos todo el histórico para no dejar el gráfico vacío
      const fallback = dataFiltered.length === 0;
      if (fallback) dataFiltered = todos;
      const titulo = fallback && (year || mes)
        ? 'Turistas extranjeros (sin datos para el filtro · mostrando histórico)'
        : 'Turistas extranjeros';
      turismoCharts['mov-mes'] = new Chart(ctxA, {
        type: 'bar',
        data: { labels: dataFiltered.map((d) => fechaLabelTurismo(d.fecha)), datasets: [{ label: titulo, data: dataFiltered.map((d) => d.valor), backgroundColor: TURISMO_COLORS.hoteles, borderRadius: 4 }] },
        options: turismoChartDefaults()
      });
    }

    // Top países (horizontal bar) — usa el resumen.topPaises (acumulado últimos 12 meses)
    destroyTurismoChart('mov-paises');
    const ctxB = document.getElementById('chart-turismo-mov-paises');
    if (ctxB && r.topPaises) {
      const palette = ['#2563eb', '#0891b2', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0ea5e9', '#14b8a6', '#facc15', '#ec4899'];
      const base = turismoChartDefaults();
      turismoCharts['mov-paises'] = new Chart(ctxB, {
        type: 'bar',
        data: { labels: r.topPaises.map((p) => p.pais), datasets: [{ label: 'Turistas', data: r.topPaises.map((p) => p.total), backgroundColor: r.topPaises.map((_, i) => palette[i % palette.length]), borderRadius: 4 }] },
        options: {
          ...base,
          indexAxis: 'y',
          plugins: { ...base.plugins, legend: { display: false } },
          // Eje Y = categorías (países) sin formatter numérico; eje X = valor numérico
          scales: {
            x: { ticks: { color: '#64748b', callback: (v) => tFmtNum(v) }, grid: { color: 'rgba(226, 232, 240, 0.7)' } },
            y: { ticks: { color: '#0f172a', font: { size: 12, weight: '600' } }, grid: { display: false } }
          }
        }
      });
    }

    // Continentes (donut) — sumo últimos 12 meses
    const fechasAll = new Set();
    movil.forEach((s) => s.data.forEach((d) => fechasAll.add(d.fecha)));
    const ultimo12 = Array.from(fechasAll).sort().slice(-12);
    const continentes = ['Europa', 'África', 'América', 'Asia'];
    const cont12 = continentes.map((c) => {
      const s = movil.find((x) => x.residencia === c);
      if (!s) return 0;
      return s.data.filter((d) => ultimo12.includes(d.fecha)).reduce((a, b) => a + b.valor, 0);
    });
    destroyTurismoChart('mov-continente');
    const ctxC = document.getElementById('chart-turismo-mov-continente');
    if (ctxC) {
      turismoCharts['mov-continente'] = new Chart(ctxC, {
        type: 'doughnut',
        data: { labels: continentes, datasets: [{ data: cont12, backgroundColor: ['#2563eb', '#d97706', '#059669', '#0891b2'], borderColor: '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
      });
    }

    // Estacionalidad media (todos los años)
    const sumByMonth = Array(12).fill(0);
    const cntByMonth = Array(12).fill(0);
    if (total) {
      total.data.forEach((d) => {
        if (!d.mes) return;
        sumByMonth[d.mes - 1] += d.valor;
        cntByMonth[d.mes - 1] += 1;
      });
    }
    const avg = sumByMonth.map((s, i) => cntByMonth[i] ? s / cntByMonth[i] : 0);
    destroyTurismoChart('mov-estacionalidad');
    const ctxD = document.getElementById('chart-turismo-mov-estacionalidad');
    if (ctxD) {
      turismoCharts['mov-estacionalidad'] = new Chart(ctxD, {
        type: 'line',
        data: { labels: MESES_CORTOS, datasets: [{ label: 'Turistas medios/mes', data: avg, borderColor: TURISMO_COLORS.hoteles, backgroundColor: 'rgba(37, 99, 235, 0.15)', fill: true, tension: 0.35, pointRadius: 4 }] },
        options: turismoChartDefaults()
      });
    }

    // Comparativa anual
    destroyTurismoChart('mov-anual');
    const ctxE = document.getElementById('chart-turismo-mov-anual');
    if (ctxE && total) {
      const porAnyo = {};
      total.data.forEach((d) => {
        if (!d.mes) return;
        if (!porAnyo[d.anyo]) porAnyo[d.anyo] = Array(12).fill(0);
        porAnyo[d.anyo][d.mes - 1] = d.valor;
      });
      const anyos = Object.keys(porAnyo).sort();
      const palette = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#e11d48'];
      turismoCharts['mov-anual'] = new Chart(ctxE, {
        type: 'line',
        data: {
          labels: MESES_CORTOS,
          datasets: anyos.map((y, i) => ({
            label: String(y), data: porAnyo[y], borderColor: palette[i % palette.length],
            backgroundColor: palette[i % palette.length] + '22', fill: false, tension: 0.3, pointRadius: 3
          }))
        },
        options: turismoChartDefaults()
      });
    }
  }

  // ====== Capacidad/oferta campings ======
  function renderTurismoOfertaCampings() {
    if (!turismoData) return;
    const series = turismoData.series.campings || [];
    const lookup = (m) => series.find((s) => s.metrica === m);
    const last = (s) => s?.data?.[s.data.length - 1];
    const item = (label, val, sub) => `<div class="turismo-oferta-item"><span class="turismo-oferta-item-label">${label}</span><span class="turismo-oferta-item-value">${val}</span>${sub ? `<span class="turismo-oferta-item-sub">${sub}</span>` : ''}</div>`;
    const grid = document.getElementById('turismo-oferta-grid');
    if (grid) {
      const est = last(lookup('establecimientos'));
      const plazas = last(lookup('plazas'));
      const parc = last(lookup('parcelas'));
      const ocupd = last(lookup('grado_ocupacion'));
      const ocupf = last(lookup('grado_ocupacion_finde'));
      const pers = last(lookup('personal_empleado'));
      grid.innerHTML = [
        item('Establecimientos', tFmtNum(est?.valor), est ? fechaLabelTurismo(est.fecha) : ''),
        item('Plazas', tFmtNum(plazas?.valor), plazas ? fechaLabelTurismo(plazas.fecha) : ''),
        item('Parcelas', tFmtNum(parc?.valor), parc ? fechaLabelTurismo(parc.fecha) : ''),
        item('Ocupación diaria', ocupd ? tFmtDec(ocupd.valor, 2) + '%' : '—', ocupd ? fechaLabelTurismo(ocupd.fecha) : ''),
        item('Ocupación fin de semana', ocupf ? tFmtDec(ocupf.valor, 2) + '%' : '—', ocupf ? fechaLabelTurismo(ocupf.fecha) : ''),
        item('Personal empleado', tFmtNum(pers?.valor), pers ? fechaLabelTurismo(pers.fecha) : '')
      ].join('');
    }

    // Chart ocupación: diario vs fin de semana
    const year = getTurismoYear();
    const mes = getTurismoMes();
    const ocupDiar = lookup('grado_ocupacion');
    const ocupFin = lookup('grado_ocupacion_finde');
    const filterY = (s) => s ? s.data.filter((d) => (!year || String(d.anyo) === String(year)) && (!mes || d.mes === mes)) : [];
    const dataD = filterY(ocupDiar);
    const dataF = filterY(ocupFin);
    destroyTurismoChart('camp-ocupacion');
    const ctxO = document.getElementById('chart-turismo-camp-ocupacion');
    if (ctxO) {
      const labels = dataD.length ? dataD.map((d) => fechaLabelTurismo(d.fecha)) : dataF.map((d) => fechaLabelTurismo(d.fecha));
      turismoCharts['camp-ocupacion'] = new Chart(ctxO, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Diario', data: dataD.map((d) => d.valor), borderColor: TURISMO_COLORS.hoteles, backgroundColor: 'rgba(37,99,235,0.15)', fill: false, tension: 0.3, pointRadius: 3 },
            { label: 'Fin de semana', data: dataF.map((d) => d.valor), borderColor: TURISMO_COLORS.campings, backgroundColor: 'rgba(217,119,6,0.15)', fill: false, tension: 0.3, pointRadius: 3 }
          ]
        },
        options: { ...turismoChartDefaults(), scales: { ...turismoChartDefaults().scales, y: { ...turismoChartDefaults().scales.y, ticks: { ...turismoChartDefaults().scales.y.ticks, callback: (v) => v + '%' } } } }
      });
    }

    // Chart parcelas ocupadas vs disponibles
    const parcS = lookup('parcelas');
    const parcOcS = lookup('parcelas_ocupadas');
    const dataPo = filterY(parcOcS);
    const dataP = filterY(parcS);
    destroyTurismoChart('camp-parcelas');
    const ctxP = document.getElementById('chart-turismo-camp-parcelas');
    if (ctxP) {
      const labels = dataP.length ? dataP.map((d) => fechaLabelTurismo(d.fecha)) : dataPo.map((d) => fechaLabelTurismo(d.fecha));
      turismoCharts['camp-parcelas'] = new Chart(ctxP, {
        data: {
          labels,
          datasets: [
            { type: 'bar', label: 'Parcelas totales', data: dataP.map((d) => d.valor), backgroundColor: 'rgba(100, 116, 139, 0.4)', borderRadius: 4 },
            { type: 'bar', label: 'Parcelas ocupadas', data: dataPo.map((d) => d.valor), backgroundColor: TURISMO_COLORS.hoteles, borderRadius: 4 }
          ]
        },
        options: turismoChartDefaults()
      });
    }
  }

  function renderTurismoAll() {
    if (!turismoData) return;
    actualizarHeroTurismo();
    renderTurismoContextRow();
    renderTurismoKPIs();
    renderTurismoResumenCharts();
    renderTurismoMiniKpis('hoteles', 'turismo-mini-hoteles');
    renderTurismoMiniKpis('apartamentos', 'turismo-mini-apartamentos');
    renderTurismoMiniKpis('campings', 'turismo-mini-campings');
    renderTurismoMovilidad();
    renderTurismoCategoriaMesChart('chart-turismo-hoteles-mes', 'hoteles');
    renderTurismoCategoriaOrigenChart('chart-turismo-hoteles-origen', 'hoteles');
    renderTurismoCategoriaAnualChart('chart-turismo-hoteles-anual', 'hoteles');
    renderTurismoApartamentos();
    renderTurismoCategoriaMesChart('chart-turismo-camp-mes', 'campings');
    renderTurismoCategoriaOrigenChart('chart-turismo-camp-origen', 'campings');
    renderTurismoCategoriaAnualChart('chart-turismo-camp-anual', 'campings');
    renderTurismoOfertaCampings();
    renderTurismoComparativa();
    renderTurismoTablas();
  }

  function initTurismo() {
    const yearSel = document.getElementById('turismo-year');
    const catSel = document.getElementById('turismo-categoria');
    const mesSel = document.getElementById('turismo-mes');
    if (yearSel) yearSel.addEventListener('change', () => { renderTurismoAll(); });
    if (catSel) catSel.addEventListener('change', () => { renderTurismoAll(); });
    if (mesSel) mesSel.addEventListener('change', () => { renderTurismoAll(); });
    document.querySelectorAll('#nav-turismo .nav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#nav-turismo .nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#main-turismo .section').forEach((s) => s.classList.remove('active'));
        const sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
        const header = document.getElementById('header-turismo');
        if (header) {
          const titles = {
            'turismo-resumen': 'Turismo - Resumen',
            'turismo-movilidad': 'Turismo - Movilidad turística (INE móvil)',
            'turismo-hoteles': 'Turismo - Hoteles',
            'turismo-apartamentos': 'Turismo - Apartamentos',
            'turismo-campings': 'Turismo - Campings',
            'turismo-comparativa': 'Turismo - Comparativa',
            'turismo-tablas': 'Turismo - Tablas INE'
          };
          const h2 = header.querySelector('h2');
          if (h2 && titles[el.dataset.section]) h2.textContent = titles[el.dataset.section];
        }
        setTimeout(() => renderTurismoAll(), 80);
      });
    });
    const btnRefresh = document.getElementById('turismo-refresh');
    if (btnRefresh) btnRefresh.addEventListener('click', () => {
      btnRefresh.disabled = true;
      const orig = btnRefresh.textContent;
      btnRefresh.textContent = 'Descargando…';
      const apiBase = (typeof apiUrl === 'function') ? apiUrl('api/turismo/refresh') : '/api/turismo/refresh';
      const dataUrlFn = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/todos.json') : '/data/TURISMO/todos.json';
      fetch(apiBase, { method: 'POST' })
        .then((r) => r.json())
        .then(() => fetch(dataUrlFn, { cache: 'no-store' }))
        .then((r) => r.json())
        .then((d) => { turismoData = d; populateTurismoFilters(); renderTurismoAll(); })
        .catch((e) => alert('Error al actualizar INE: ' + (e.message || e)))
        .finally(() => { btnRefresh.disabled = false; btnRefresh.textContent = orig; });
    });
  }

  function init() {
    initCamaras();
    initResiduos();
    initTurismo();
    loadCamarasData();
    document.querySelectorAll('#nav-camaras .nav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#nav-camaras .nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#main-camaras .section').forEach((s) => s.classList.remove('active'));
        const sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
        if (el.dataset.section === 'camaras-camara') {
          setTimeout(function () { initMapaCamaras(); invalidateMapaCamaras(); }, 180);
        }
        const header = document.getElementById('header-camaras');
        if (header) {
          const titles = { 'camaras-entradas': 'Cámaras LPR - Entradas y salidas', 'camaras-trafico': 'Tráfico por Vehículo y Dirección', 'camaras-camara': 'Tráfico por cámara', 'camaras-nacionalidad': 'Tráfico por nacionalidad', 'camaras-color': 'Vehículos por color' };
          const h2 = header.querySelector('h2');
          if (h2 && titles[el.dataset.section]) h2.textContent = titles[el.dataset.section];
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
