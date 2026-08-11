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
  let mode = 'landing';
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
    var explicit = (typeof window.__DASHBOARD_API_PORT__ !== 'undefined' && window.__DASHBOARD_API_PORT__ !== null);
    var nodePort = String(explicit ? window.__DASHBOARD_API_PORT__ : 7777);
    // Abierto como archivo local (file://): el backend está en localhost:puerto.
    if (loc.protocol === 'file:') return 'http://localhost:' + nodePort;
    // Solo apuntar a otro puerto si se ha configurado explícitamente (p. ej. Live Server).
    // En el resto de casos (npm start en :7777 o producción en :443) la API es del mismo origen.
    if (explicit) {
      var cur = loc.port || (loc.protocol === 'https:' ? '443' : '80');
      if (String(cur) === nodePort) return '';
      return loc.protocol + '//' + loc.hostname + ':' + nodePort;
    }
    return '';
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
    const reloadBtn = document.getElementById('camaras-reload');
    if (reloadBtn) reloadBtn.addEventListener('click', loadCamarasData);
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
      initLprFiltros();
      renderAllLpr();
      initMultiFiltros();
      initMultiSelect();
      renderCamarasMultiobjeto();
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

  // ===== AFORO MULTIOBJETO (personas y vehículos por cámara/calle) =====
  var multiCharts = {};
  var mapaMultiobjeto = null;
  var BARRA_RADIO = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };

  function multiNf(n) { return (typeof tFmtNum === 'function') ? tFmtNum(n) : Math.round(n || 0).toLocaleString('es-ES'); }
  function multiCorta(k) { return k.length > 24 ? k.slice(0, 21) + '…' : k; }
  function multiNombre(c) { return String(c || '').replace(/^\d+\s*-\s*/, ''); }
  // Filas "(agregado)": totales de julio sin desglose por cámara. Cuentan en KPIs
  // y evolución mensual, pero se excluyen de mapa/calles/por-cámara.
  function multiEsAgregado(c) { return /\(agregado\)/i.test(String(c || '')); }
  function mesEtiqueta(ym) { var p = String(ym).split('-'); if (p.length < 2) return ym; var mi = parseInt(p[1], 10) - 1; return (MESES[mi] || p[1]) + ' ' + p[0]; }
  function multiMetricVal(o, m) { if (!o) return 0; if (m === 'vm') return o.vm; if (m === 'vs') return o.vs; if (m === 'tot') return o.p + o.vm + o.vs; return o.p; }
  function multiMetricLabel(m) { return m === 'vm' ? 'vehículos a motor' : m === 'vs' ? 'vehículos sin motor' : m === 'tot' ? 'paso total' : 'personas'; }
  function multiColor(t) {
    t = Math.max(0, Math.min(1, t));
    var a, b, f;
    if (t < 0.5) { a = [34, 197, 94]; b = [245, 200, 30]; f = t / 0.5; }
    else { a = [245, 200, 30]; b = [239, 68, 68]; f = (t - 0.5) / 0.5; }
    var c = a.map(function (v, i) { return Math.round(v + (b[i] - v) * f); });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }
  function multiDestroy(k) { if (multiCharts[k]) { try { multiCharts[k].destroy(); } catch (_) {} multiCharts[k] = null; } }

  function multiFiltro() {
    return {
      anio: (document.getElementById('multi-f-anio') || {}).value || '',
      mes: (document.getElementById('multi-f-mes') || {}).value || '',
      cam: (document.getElementById('multi-f-cam') || {}).value || '',
      desde: (document.getElementById('multi-f-desde') || {}).value || '',
      hasta: (document.getElementById('multi-f-hasta') || {}).value || ''
    };
  }
  function multiFechaCompleta(r) { return r.fecha + '-' + ('' + (r.dia || 1)).padStart(2, '0'); }
  function multiPasaFiltro(r, f) {
    if (f.cam && r.camara !== f.cam) return false;
    if (f.desde || f.hasta) {
      var fd = multiFechaCompleta(r);
      if (f.desde && fd < f.desde) return false;
      if (f.hasta && fd > f.hasta) return false;
      return true; // el rango personalizado ignora año/mes
    }
    if (f.mes && r.fecha !== f.mes) return false;
    if (f.anio && String(r.fecha).slice(0, 4) !== f.anio) return false;
    return true;
  }
  function multiAgg() {
    var m = (camarasData && camarasData.multiobjeto) || [];
    var f = multiFiltro();
    var totP = 0, totM = 0, totS = 0, porMes = {}, porCam = {}, porCamMes = {};
    m.forEach(function (r) {
      if (!multiPasaFiltro(r, f)) return;
      var pa = r.personas_avanzar || 0, pr = r.personas_retroceso || 0;
      var va = r.vehiculos_motor_avanzar || 0, vr = r.vehiculos_motor_retroceso || 0;
      var sa = r.vehiculos_sin_motor_avanzar || 0, sr = r.vehiculos_sin_motor_retroceso || 0;
      var p = pa + pr, vm = va + vr, vs = sa + sr;
      totP += p; totM += vm; totS += vs;
      var mes = r.fecha;
      if (mes) { if (!porMes[mes]) porMes[mes] = { p: 0, vm: 0, vs: 0 }; porMes[mes].p += p; porMes[mes].vm += vm; porMes[mes].vs += vs; }
      var c = r.camara || '—';
      if (!multiEsAgregado(c)) {
        if (!porCam[c]) porCam[c] = { p: 0, vm: 0, vs: 0, pa: 0, pr: 0, va: 0, vr: 0, sa: 0, sr: 0 };
        var o = porCam[c]; o.p += p; o.vm += vm; o.vs += vs; o.pa += pa; o.pr += pr; o.va += va; o.vr += vr; o.sa += sa; o.sr += sr;
        if (mes) { if (!porCamMes[c]) porCamMes[c] = {}; if (!porCamMes[c][mes]) porCamMes[c][mes] = { p: 0, vm: 0, vs: 0 }; var q = porCamMes[c][mes]; q.p += p; q.vm += vm; q.vs += vs; }
      }
    });
    return { totP: totP, totM: totM, totS: totS, porMes: porMes, porCam: porCam, porCamMes: porCamMes, meses: Object.keys(porMes).sort(), cams: Object.keys(porCam) };
  }

  function multiFechas() { var m = (camarasData && camarasData.multiobjeto) || []; return Object.keys(m.reduce(function (a, r) { a[r.fecha] = 1; return a; }, {})).sort(); }
  function multiPoblarMeses() {
    var sel = document.getElementById('multi-f-mes'); if (!sel) return;
    var anio = (document.getElementById('multi-f-anio') || {}).value || '';
    var fechas = multiFechas().filter(function (x) { return !anio || x.slice(0, 4) === anio; });
    var prev = sel.value;
    sel.innerHTML = ''; sel.appendChild(new Option('Todos los meses', ''));
    fechas.forEach(function (x) { var etq = anio ? (MESES[parseInt(x.slice(5, 7), 10) - 1] || x) : mesEtiqueta(x); sel.appendChild(new Option(etq, x)); });
    sel.value = (prev && fechas.indexOf(prev) >= 0) ? prev : '';
  }
  function multiActualizarNota() {
    var f = multiFiltro(); var nota = document.getElementById('multi-f-nota'); if (!nota) return;
    nota.textContent = (f.desde || f.hasta) ? '⚠ Rango personalizado activo (ignora año/mes)' : '';
  }
  function renderActiveMulti() {
    var active = document.querySelector('#main-camaras .section.active');
    var id = active ? active.id : '';
    if (id === 'section-camaras-multiobjeto-calles') renderMultiCalles();
    else if (id === 'section-camaras-multiobjeto-detalle') { initMultiSelect(); renderMultiDetalle(); }
    else { renderCamarasMultiobjeto(); if (mapaMultiobjeto) setTimeout(function () { if (mapaMultiobjeto) mapaMultiobjeto.invalidateSize(true); }, 80); }
  }
  function initMultiFiltros() {
    var m = (camarasData && camarasData.multiobjeto) || [];
    var fechas = multiFechas();
    var anios = Object.keys(fechas.reduce(function (a, x) { a[x.slice(0, 4)] = 1; return a; }, {})).sort();
    var cams = Object.keys(m.reduce(function (a, r) { a[r.camara] = 1; return a; }, {})).filter(function (c) { return !multiEsAgregado(c); }).sort();
    var aSel = document.getElementById('multi-f-anio');
    if (aSel) { var pa = aSel.value; aSel.innerHTML = ''; aSel.appendChild(new Option('Todos los años', '')); anios.forEach(function (a) { aSel.appendChild(new Option(a, a)); }); if (pa) aSel.value = pa; }
    multiPoblarMeses();
    var cSel = document.getElementById('multi-f-cam');
    if (cSel) { var pc = cSel.value; cSel.innerHTML = ''; cSel.appendChild(new Option('Todas las cámaras', '')); cams.forEach(function (c) { cSel.appendChild(new Option(multiNombre(c), c)); }); if (pc) cSel.value = pc; }
    // límites de fecha en los date pickers
    if (fechas.length) {
      var min = fechas[0] + '-01';
      var lm = fechas[fechas.length - 1]; var ld = new Date(parseInt(lm.slice(0, 4), 10), parseInt(lm.slice(5, 7), 10), 0).getDate();
      var max = lm + '-' + ('' + ld).padStart(2, '0');
      ['multi-f-desde', 'multi-f-hasta'].forEach(function (id) { var el = document.getElementById(id); if (el) { el.min = min; el.max = max; } });
    }
    ['multi-f-anio', 'multi-f-mes', 'multi-f-cam', 'multi-f-desde', 'multi-f-hasta'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el._bound) { el.addEventListener('change', function () { if (id === 'multi-f-anio') multiPoblarMeses(); multiActualizarNota(); renderActiveMulti(); }); el._bound = true; }
    });
    var clr = document.getElementById('multi-f-clear');
    if (clr && !clr._bound) { clr.addEventListener('click', function () { ['multi-f-anio', 'multi-f-mes', 'multi-f-cam', 'multi-f-desde', 'multi-f-hasta'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; }); multiPoblarMeses(); multiActualizarNota(); renderActiveMulti(); }); clr._bound = true; }
    multiActualizarNota();
  }

  // Vista 1: resumen (KPIs) + mapa de afluencia + ranking lateral
  function renderCamarasMultiobjeto() {
    var agg = multiAgg();
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    if (!agg.meses.length) {
      ['personas', 'motor', 'sinmotor', 'camaras', 'rango'].forEach(function (k) { set('multi-kpi-' + k, '—'); });
      return;
    }
    set('multi-kpi-personas', multiNf(agg.totP));
    set('multi-kpi-motor', multiNf(agg.totM));
    set('multi-kpi-sinmotor', multiNf(agg.totS));
    set('multi-kpi-camaras', agg.cams.length || '—');
    set('multi-kpi-rango', agg.meses.length ? (mesEtiqueta(agg.meses[0]) + ' – ' + mesEtiqueta(agg.meses[agg.meses.length - 1])) : '—');
    updateMultiMapa(agg);
  }

  function updateMultiMapa(agg) {
    agg = agg || multiAgg();
    if (!agg.cams.length) {
      if (mapaMultiobjeto) { try { mapaMultiobjeto.remove(); } catch (_) {} mapaMultiobjeto = null; }
      var cont = document.getElementById('mapa-multiobjeto');
      if (cont) cont.innerHTML = '<p style="padding:2rem;color:#64748b;text-align:center">Este periodo va como <b>total municipal</b> (sin desglose por cámara).</p>';
      var ol = document.getElementById('multi-top-calles'); if (ol) ol.innerHTML = '';
      return;
    }
    drawMapaMultiobjeto(agg);
    renderMultiTopList(agg);
  }

  function renderMultiTopList(agg) {
    var ol = document.getElementById('multi-top-calles'); if (!ol) return;
    var metric = (document.getElementById('multi-mapa-metrica') || {}).value || 'p';
    var tit = document.getElementById('multi-top-titulo'); if (tit) tit.textContent = 'Calles más concurridas (' + multiMetricLabel(metric) + ')';
    var ent = agg.cams.map(function (c) { return { c: c, v: multiMetricVal(agg.porCam[c], metric) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    var max = ent.length ? ent[0].v : 1;
    ol.innerHTML = '';
    ent.forEach(function (x, i) {
      var pct = max ? Math.round(x.v / max * 100) : 0;
      var li = document.createElement('li');
      li.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:3px"><span style="font-size:.85rem;color:#334155"><b style="color:#94a3b8">' + (i + 1) + '.</b> ' + multiNombre(x.c) + '</span><span style="font-size:.84rem;font-weight:600;color:#0f172a">' + multiNf(x.v) + '</span></div><div style="height:7px;background:#eef2f7;border-radius:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + multiColor(max ? x.v / max : 0) + ';border-radius:6px"></div></div>';
      ol.appendChild(li);
    });
  }

  function drawMapaMultiobjeto(agg) {
    var container = document.getElementById('mapa-multiobjeto');
    if (!container || typeof L === 'undefined') return;
    var metric = (document.getElementById('multi-mapa-metrica') || {}).value || 'p';
    var mapaArr = (camarasData && camarasData.camarasMapa) || [];
    var coordOf = function (nombre) { var e = mapaArr.find(function (x) { return x.nombre === nombre; }); return e ? camaraLatLng(e) : null; };
    var pts = agg.cams.map(function (c) { var ll = coordOf(c); return ll ? { c: c, ll: ll, v: multiMetricVal(agg.porCam[c], metric) } : null; })
      .filter(function (x) { return x && coordsEnTerminoPeniscola(x.ll[0], x.ll[1]); });
    if (mapaMultiobjeto) { mapaMultiobjeto.remove(); mapaMultiobjeto = null; }
    if (!pts.length) { container.innerHTML = '<p style="padding:2rem;color:#64748b">Sin coordenadas para las cámaras.</p>'; return; }
    container.innerHTML = '';
    var max = Math.max.apply(null, pts.map(function (x) { return x.v; })) || 1;
    try {
      mapaMultiobjeto = L.map('mapa-multiobjeto', Object.assign({}, mapOptionsPeniscola())).setView(pts[0].ll, 14);
      addDashboardBasemap(mapaMultiobjeto);
      pts.sort(function (a, b) { return a.v - b.v; }); // mayores encima
      pts.forEach(function (x) {
        var t = x.v / max;
        L.circleMarker(x.ll, { radius: 9 + 24 * Math.sqrt(t), color: '#ffffff', weight: 1.5, fillColor: multiColor(t), fillOpacity: 0.82 })
          .addTo(mapaMultiobjeto)
          .bindPopup('<strong>' + multiNombre(x.c) + '</strong><br>' + multiMetricLabel(metric) + ': ' + multiNf(x.v));
      });
      mapaMultiobjeto.fitBounds(L.latLngBounds(pts.map(function (x) { return x.ll; })), { padding: [35, 35] });
      mapaMultiobjeto.whenReady(function () {
        setTimeout(function () { if (mapaMultiobjeto) mapaMultiobjeto.invalidateSize(true); }, 0);
        setTimeout(function () { if (mapaMultiobjeto) mapaMultiobjeto.invalidateSize(true); }, 350);
      });
    } catch (e) { container.innerHTML = '<p style="padding:2rem;color:#f43f5e">Error al cargar el mapa: ' + (e.message || e) + '</p>'; }
  }

  // Vista 2: calles más concurridas (ranking + evolución + tabla)
  function renderMultiCalles() {
    var agg = multiAgg();
    if (!agg.cams.length) {
      ['camP', 'camV', 'evol'].forEach(multiDestroy);
      var t0 = document.getElementById('multi-tabla');
      if (t0) t0.innerHTML = '<tbody><tr><td style="padding:1rem;color:#64748b">Este periodo va como total municipal (sin desglose por cámara).</td></tr></tbody>';
      return;
    }
    var opts = chartCartesianOptions();
    var entP = agg.cams.map(function (c) { return [c, agg.porCam[c].p]; }).sort(function (a, b) { return b[1] - a[1]; });
    multiDestroy('camP');
    var cP = document.getElementById('chart-multi-cam-personas');
    if (cP) multiCharts.camP = new Chart(cP, { type: 'bar', data: { labels: entP.map(function (e) { return multiCorta(e[0]); }), datasets: [{ label: 'Personas', data: entP.map(function (e) { return e[1]; }), backgroundColor: '#2563eb', borderRadius: BARRA_RADIO }] }, options: Object.assign({ indexAxis: 'y' }, opts) });
    var entV = agg.cams.map(function (c) { return [c, agg.porCam[c].vm + agg.porCam[c].vs]; }).sort(function (a, b) { return b[1] - a[1]; });
    multiDestroy('camV');
    var cV = document.getElementById('chart-multi-cam-veh');
    if (cV) multiCharts.camV = new Chart(cV, { type: 'bar', data: { labels: entV.map(function (e) { return multiCorta(e[0]); }), datasets: [{ label: 'Vehículos', data: entV.map(function (e) { return e[1]; }), backgroundColor: '#16a34a', borderRadius: BARRA_RADIO }] }, options: Object.assign({ indexAxis: 'y' }, opts) });
    multiDestroy('evol');
    var cE = document.getElementById('chart-multi-evolucion');
    if (cE) multiCharts.evol = new Chart(cE, { type: 'line', data: { labels: agg.meses.map(mesEtiqueta), datasets: [
      { label: 'Personas', data: agg.meses.map(function (x) { return agg.porMes[x].p; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.3 },
      { label: 'Vehículos a motor', data: agg.meses.map(function (x) { return agg.porMes[x].vm; }), borderColor: '#16a34a', fill: false, tension: 0.3 },
      { label: 'Vehículos sin motor', data: agg.meses.map(function (x) { return agg.porMes[x].vs; }), borderColor: '#f59e0b', fill: false, tension: 0.3 }
    ] }, options: opts });
    renderMultiTabla(agg);
  }

  function renderMultiTabla(agg) {
    var t = document.getElementById('multi-tabla'); if (!t) return;
    var rows = agg.cams.map(function (c) { var o = agg.porCam[c]; return { c: c, p: o.p, vm: o.vm, vs: o.vs, tot: o.p + o.vm + o.vs }; }).sort(function (a, b) { return b.p - a.p; });
    var th = '<thead><tr style="text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:.82rem"><th style="padding:.5rem .4rem">#</th><th style="padding:.5rem .4rem">Calle</th><th style="padding:.5rem .4rem;text-align:right">Personas</th><th style="padding:.5rem .4rem;text-align:right">Veh. motor</th><th style="padding:.5rem .4rem;text-align:right">Sin motor</th><th style="padding:.5rem .4rem;text-align:right">Total</th></tr></thead>';
    var tb = '<tbody>' + rows.map(function (x, i) { return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:.45rem .4rem;color:#94a3b8">' + (i + 1) + '</td><td style="padding:.45rem .4rem;color:#334155">' + multiNombre(x.c) + '</td><td style="padding:.45rem .4rem;text-align:right;font-weight:600">' + multiNf(x.p) + '</td><td style="padding:.45rem .4rem;text-align:right">' + multiNf(x.vm) + '</td><td style="padding:.45rem .4rem;text-align:right">' + multiNf(x.vs) + '</td><td style="padding:.45rem .4rem;text-align:right;color:#64748b">' + multiNf(x.tot) + '</td></tr>'; }).join('') + '</tbody>';
    t.innerHTML = th + tb;
  }

  // Vista 3: detalle por cámara
  function initMultiSelect() {
    var sel = document.getElementById('multi-cam-select'); if (!sel) return;
    var agg = multiAgg();
    var prev = sel.value;
    sel.innerHTML = '';
    agg.cams.slice().sort().forEach(function (c) { sel.appendChild(new Option(multiNombre(c), c)); });
    if (prev && agg.cams.indexOf(prev) >= 0) sel.value = prev;
    if (!sel._bound) { sel.addEventListener('change', renderMultiDetalle); sel._bound = true; }
    var met = document.getElementById('multi-mapa-metrica');
    if (met && !met._bound) { met.addEventListener('change', function () { updateMultiMapa(); }); met._bound = true; }
  }

  function renderMultiDetalle() {
    var agg = multiAgg();
    var sel = document.getElementById('multi-cam-select');
    if (!sel) return;
    if (!agg.cams.length) {
      ['detEvol', 'detRep', 'detSen'].forEach(multiDestroy);
      ['personas', 'motor', 'sinmotor'].forEach(function (k) { var e = document.getElementById('multi-det-' + k); if (e) e.textContent = '—'; });
      return;
    }
    var c = sel.value || agg.cams[0];
    var o = agg.porCam[c]; if (!o) return;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set('multi-det-personas', multiNf(o.p));
    set('multi-det-motor', multiNf(o.vm));
    set('multi-det-sinmotor', multiNf(o.vs));
    var opts = chartCartesianOptions();
    var cm = agg.porCamMes[c] || {};
    var meses = Object.keys(cm).sort();
    multiDestroy('detEvol');
    var cE = document.getElementById('chart-multi-det-evol');
    if (cE) multiCharts.detEvol = new Chart(cE, { type: 'line', data: { labels: meses.map(mesEtiqueta), datasets: [
      { label: 'Personas', data: meses.map(function (x) { return cm[x].p; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.3 },
      { label: 'Veh. motor', data: meses.map(function (x) { return cm[x].vm; }), borderColor: '#16a34a', fill: false, tension: 0.3 },
      { label: 'Veh. sin motor', data: meses.map(function (x) { return cm[x].vs; }), borderColor: '#f59e0b', fill: false, tension: 0.3 }
    ] }, options: opts });
    multiDestroy('detRep');
    var cR = document.getElementById('chart-multi-det-reparto');
    if (cR) multiCharts.detRep = new Chart(cR, { type: 'doughnut', data: { labels: ['Personas', 'Veh. motor', 'Veh. sin motor'], datasets: [{ data: [o.p, o.vm, o.vs], backgroundColor: ['#2563eb', '#16a34a', '#f59e0b'] }] }, options: chartRadialOptions({ cutout: '60%' }) });
    multiDestroy('detSen');
    var cS = document.getElementById('chart-multi-det-sentido');
    if (cS) multiCharts.detSen = new Chart(cS, { type: 'bar', data: { labels: ['Personas', 'Veh. motor', 'Veh. sin motor'], datasets: [
      { label: 'Avanzar', data: [o.pa, o.va, o.sa], backgroundColor: '#2563eb', borderRadius: BARRA_RADIO },
      { label: 'Retroceso', data: [o.pr, o.vr, o.sr], backgroundColor: '#94a3b8', borderRadius: BARRA_RADIO }
    ] }, options: opts });
  }

  // ============ LPR (matrículas) — vistas rediseñadas + filtros ============
  var mapaLpr = null;
  var NOID_KEYS = ['No compatible', 'No Compatible', 'No reconocido', 'No Reconocido'];
  // Países considerados europeos (el resto de identificados + Georgia van a "Otros").
  var LPR_EUROPA = {};
  ['Francia', 'Alemania', 'Gran Bretaña', 'Reino Unido', 'Italia', 'Portugal', 'Bélgica', 'Países Bajos', 'Suiza', 'Austria', 'Irlanda', 'Luxemburgo', 'Dinamarca', 'Suecia', 'Finlandia', 'Noruega', 'Islandia', 'Polonia', 'República Checa', 'Eslovaquia', 'Hungría', 'Rumanía', 'Bulgaria', 'Grecia', 'Croacia', 'Eslovenia', 'Estonia', 'Letonia', 'Lituania', 'Malta', 'Chipre', 'Ucrania', 'República de Belarús', 'Moldavia', 'Serbia', 'Bosnia y Herzegovina', 'Albania', 'Macedonia del Norte', 'Kosovo', 'Montenegro', 'Liechtenstein'].forEach(function (k) { LPR_EUROPA[k] = 1; });
  function lprNombre(c) { return String(c || '').replace(/\s*LPR\s*$/i, '').trim(); }
  function lprData() { return (camarasData && camarasData.lpr) || {}; }
  function lprFiltro() {
    return {
      anio: (document.getElementById('lpr-f-anio') || {}).value || '',
      mes: (document.getElementById('lpr-f-mes') || {}).value || '',
      dir: (document.getElementById('lpr-f-dir') || {}).value || '',
      cam: (document.getElementById('lpr-f-cam') || {}).value || ''
    };
  }
  function lprClavesMes() {
    var pm = lprData().porMes || {};
    var k = Object.keys(pm);
    return k.length ? k : Object.keys(lprData().entradasSalidasPorMes || {});
  }
  function lprMesesFiltrados() {
    var f = lprFiltro();
    return lprClavesMes().filter(function (m) {
      if (f.mes) return m === f.mes;
      if (f.anio) return m.slice(0, 4) === f.anio;
      return true;
    }).sort();
  }
  function lprCamaras() {
    var pm = lprData().porMes || {}; var set = {};
    Object.keys(pm).forEach(function (m) { var ch = pm[m].camaraHora || {}; Object.keys(ch).forEach(function (c) { set[c] = 1; }); });
    if (!Object.keys(set).length) Object.keys(lprData().byCamara || {}).forEach(function (c) { set[c] = 1; });
    return Object.keys(set).sort();
  }
  function lprDirVal(o, dir) { if (!o) return 0; if (dir === 'av') return o.av; if (dir === 're') return o.re; return o.av + o.re + o.ot; }
  // Agrega camaraHora sobre los meses filtrados. applyCam=true respeta el filtro de cámara.
  function lprCHAgg(applyCam) {
    var pm = lprData().porMes || {};
    var f = lprFiltro();
    var cam = applyCam ? f.cam : '';
    var meses = lprMesesFiltrados();
    var porCam = {}, porHora = {};
    meses.forEach(function (mes) {
      var ch = (pm[mes] && pm[mes].camaraHora) || {};
      Object.keys(ch).forEach(function (c) {
        if (cam && c !== cam) return;
        var horas = ch[c];
        Object.keys(horas).forEach(function (h) {
          var o = horas[h];
          if (!porCam[c]) porCam[c] = { av: 0, re: 0, ot: 0 };
          porCam[c].av += o.av; porCam[c].re += o.re; porCam[c].ot += o.ot;
          if (!porHora[h]) porHora[h] = { av: 0, re: 0, ot: 0 };
          porHora[h].av += o.av; porHora[h].re += o.re; porHora[h].ot += o.ot;
        });
      });
    });
    return { porCam: porCam, porHora: porHora, meses: meses };
  }
  // Evolución mensual (respeta AÑO, no el mes concreto; respeta cámara).
  function lprMensualCH() {
    var pm = lprData().porMes || {};
    var f = lprFiltro();
    var meses = lprClavesMes().filter(function (m) { return !f.anio || m.slice(0, 4) === f.anio; }).sort();
    var data = {};
    meses.forEach(function (mes) {
      var ch = (pm[mes] && pm[mes].camaraHora) || {}; var acc = { av: 0, re: 0, ot: 0 };
      Object.keys(ch).forEach(function (c) { if (f.cam && c !== f.cam) return; var horas = ch[c]; Object.keys(horas).forEach(function (h) { var o = horas[h]; acc.av += o.av; acc.re += o.re; acc.ot += o.ot; }); });
      data[mes] = acc;
    });
    return { meses: meses, data: data };
  }
  // Desgloses país/color/marca/tipo por año/mes (no dependen de cámara/sentido).
  function lprDimAgg() {
    var l = lprData(); var pm = l.porMes || {};
    if (!Object.keys(pm).length) return { pais: l.byNacionalidad || {}, color: l.byColor || {}, marca: l.byMarca || {}, tipo: l.byTipo || {} };
    var meses = lprMesesFiltrados(); var agg = { pais: {}, color: {}, marca: {}, tipo: {} };
    meses.forEach(function (m) { var d = pm[m] || {}; ['pais', 'color', 'marca', 'tipo'].forEach(function (dim) { var src = d[dim] || {}; Object.keys(src).forEach(function (k) { agg[dim][k] = (agg[dim][k] || 0) + src[k]; }); }); });
    return agg;
  }

  function renderLprResumen() {
    var f = lprFiltro();
    var ch = lprCHAgg(false); // el mapa muestra todas las cámaras
    var dim = lprDimAgg();
    var meses = ch.meses;
    var porCam = ch.porCam;
    var totAv = 0, totRe = 0, totOt = 0;
    Object.keys(porCam).forEach(function (c) { totAv += porCam[c].av; totRe += porCam[c].re; totOt += porCam[c].ot; });
    var total = f.dir === 'av' ? totAv : (f.dir === 're' ? totRe : (totAv + totRe + totOt));
    var nac = dim.pais;
    var esp = nac['España'] || nac['Espana'] || 0;
    var noId = NOID_KEYS.reduce(function (s, k) { return s + (nac[k] || 0); }, 0);
    var totalNac = Object.keys(nac).reduce(function (s, k) { return s + nac[k]; }, 0);
    var intl = totalNac - esp - noId, ident = esp + intl;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    if (!meses.length && !Object.keys(porCam).length) return;
    set('lpr-kpi-total', multiNf(total));
    set('lpr-kpi-rango', meses.length ? (mesEtiqueta(meses[0]) + (meses.length > 1 ? ' – ' + mesEtiqueta(meses[meses.length - 1]) : '')) : '—');
    set('lpr-kpi-entradas', multiNf(totAv));
    set('lpr-kpi-salidas', multiNf(totRe));
    set('lpr-kpi-intl', (ident ? Math.round(intl / ident * 100) : 0) + '%');
    set('lpr-kpi-intl-sub', multiNf(intl) + ' de ' + multiNf(ident) + ' identificadas');
    var vals = {};
    Object.keys(porCam).forEach(function (c) { vals[c] = lprDirVal(porCam[c], f.dir); });
    drawMapaLpr(vals);
    renderLprTopAccesos(vals);
  }

  function drawMapaLpr(byCam) {
    var container = document.getElementById('mapa-lpr');
    if (!container || typeof L === 'undefined') return;
    var mapaArr = (camarasData && camarasData.camarasMapa) || [];
    var pts = Object.keys(byCam).map(function (c) {
      var e = mapaArr.find(function (x) { return x.nombre === c; });
      var ll = e ? camaraLatLng(e) : null;
      return ll ? { c: c, ll: ll, v: byCam[c] } : null;
    }).filter(function (x) { return x && coordsEnTerminoPeniscola(x.ll[0], x.ll[1]); });
    if (mapaLpr) { mapaLpr.remove(); mapaLpr = null; }
    if (!pts.length) { container.innerHTML = '<p style="padding:2rem;color:#64748b">Sin coordenadas para las cámaras.</p>'; return; }
    container.innerHTML = '';
    var max = Math.max.apply(null, pts.map(function (x) { return x.v; })) || 1;
    try {
      mapaLpr = L.map('mapa-lpr', Object.assign({}, mapOptionsPeniscola())).setView(pts[0].ll, 13);
      addDashboardBasemap(mapaLpr);
      pts.sort(function (a, b) { return a.v - b.v; });
      pts.forEach(function (x) {
        var t = x.v / max;
        L.circleMarker(x.ll, { radius: 9 + 24 * Math.sqrt(t), color: '#ffffff', weight: 1.5, fillColor: multiColor(t), fillOpacity: 0.82 })
          .addTo(mapaLpr).bindPopup('<strong>' + lprNombre(x.c) + '</strong><br>Vehículos: ' + multiNf(x.v));
      });
      mapaLpr.fitBounds(L.latLngBounds(pts.map(function (x) { return x.ll; })), { padding: [35, 35] });
      mapaLpr.whenReady(function () {
        setTimeout(function () { if (mapaLpr) mapaLpr.invalidateSize(true); }, 0);
        setTimeout(function () { if (mapaLpr) mapaLpr.invalidateSize(true); }, 350);
      });
    } catch (e) { container.innerHTML = '<p style="padding:2rem;color:#f43f5e">Error al cargar el mapa: ' + (e.message || e) + '</p>'; }
  }

  function renderLprTopAccesos(byCam) {
    var ol = document.getElementById('lpr-top-accesos'); if (!ol) return;
    var ent = Object.keys(byCam).map(function (c) { return { c: c, v: byCam[c] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    var max = ent.length ? ent[0].v : 1;
    ol.innerHTML = '';
    ent.forEach(function (x, i) {
      var pct = max ? Math.round(x.v / max * 100) : 0;
      var li = document.createElement('li');
      li.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:3px"><span style="font-size:.85rem;color:#334155"><b style="color:#94a3b8">' + (i + 1) + '.</b> ' + lprNombre(x.c) + '</span><span style="font-size:.84rem;font-weight:600;color:#0f172a">' + multiNf(x.v) + '</span></div><div style="height:7px;background:#eef2f7;border-radius:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + multiColor(max ? x.v / max : 0) + ';border-radius:6px"></div></div>';
      ol.appendChild(li);
    });
  }

  function renderLprEvolucion() {
    var l = lprData();
    var f = lprFiltro();
    var opts = chartCartesianOptions();
    // Evolución mensual desde camaraHora (respeta año + sentido + cámara).
    var mm = lprMensualCH();
    var dsM = [];
    if (f.dir !== 're') dsM.push({ label: 'Entradas', data: mm.meses.map(function (m) { return mm.data[m].av; }), backgroundColor: '#2563eb', borderRadius: BARRA_RADIO });
    if (f.dir !== 'av') dsM.push({ label: 'Salidas', data: mm.meses.map(function (m) { return mm.data[m].re; }), backgroundColor: '#f59e0b', borderRadius: BARRA_RADIO });
    multiDestroy('lprMes');
    var cM = document.getElementById('chart-lpr-mes');
    if (cM) multiCharts.lprMes = new Chart(cM, { type: 'bar', data: { labels: mm.meses.map(mesEtiqueta), datasets: dsM }, options: opts });
    // Tráfico diario: entradasSalidasPorDia (todas las cámaras) por sentido + año/mes.
    // No hay datos diarios por cámara, así que se oculta al filtrar una cámara concreta.
    var dia = l.entradasSalidasPorDia || {};
    var cD = document.getElementById('chart-lpr-dia');
    var card = cD && cD.closest('.camaras-chart-card');
    multiDestroy('lprDia');
    if (f.cam) {
      if (card) card.style.display = 'none';
    } else {
      if (card) card.style.display = '';
      var dias = Object.keys(dia).filter(function (d) {
        if (f.mes) return d.slice(0, 7) === f.mes;
        if (f.anio) return d.slice(0, 4) === f.anio;
        return true;
      }).sort();
      var dsD = [];
      if (f.dir !== 're') dsD.push({ label: 'Entradas', data: dias.map(function (d) { return dia[d].Avance || 0; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.10)', fill: true, tension: 0.25, pointRadius: 0 });
      if (f.dir !== 'av') dsD.push({ label: 'Salidas', data: dias.map(function (d) { return dia[d].Retroceso || 0; }), borderColor: '#f59e0b', fill: false, tension: 0.25, pointRadius: 0 });
      if (cD) multiCharts.lprDia = new Chart(cD, { type: 'line', data: { labels: dias, datasets: dsD }, options: opts });
    }
  }

  function renderLprHorario() {
    var f = lprFiltro();
    var h = lprCHAgg(true).porHora || {};
    var horas = []; for (var i = 0; i < 24; i++) horas.push(i);
    var ent = horas.map(function (i) { return (h[i] || {}).av || 0; });
    var sal = horas.map(function (i) { return (h[i] || {}).re || 0; });
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    var argmax = function (arr) { var mi = 0; arr.forEach(function (v, i) { if (v > arr[mi]) mi = i; }); return mi; };
    set('lpr-kpi-hora-ent', (ent.some(function (v) { return v; }) ? ('' + argmax(ent)).padStart(2, '0') + ':00 h' : '—'));
    set('lpr-kpi-hora-sal', (sal.some(function (v) { return v; }) ? ('' + argmax(sal)).padStart(2, '0') + ':00 h' : '—'));
    var opts = chartCartesianOptions();
    var ds = [];
    if (f.dir !== 're') ds.push({ label: 'Entradas', data: ent, backgroundColor: '#2563eb', borderRadius: BARRA_RADIO });
    if (f.dir !== 'av') ds.push({ label: 'Salidas', data: sal, backgroundColor: '#f59e0b', borderRadius: BARRA_RADIO });
    multiDestroy('lprHora');
    var c = document.getElementById('chart-lpr-hora');
    if (c) multiCharts.lprHora = new Chart(c, { type: 'bar', data: { labels: horas.map(function (i) { return ('' + i).padStart(2, '0') + 'h'; }), datasets: ds }, options: opts });
  }

  function renderLprProcedencia() {
    var nac = lprDimAgg().pais || {};
    var esp = nac['España'] || nac['Espana'] || 0;
    var noId = NOID_KEYS.reduce(function (s, k) { return s + (nac[k] || 0); }, 0);
    var total = Object.keys(nac).reduce(function (s, k) { return s + nac[k]; }, 0);
    var intl = total - esp - noId;
    var ident = esp + intl;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set('lpr-kpi-nac', multiNf(esp));
    set('lpr-kpi-intl2', multiNf(intl));
    set('lpr-kpi-intl2-sub', (ident ? Math.round(intl / ident * 100) : 0) + '% de identificadas');
    // Europeos individuales; resto de identificados (fuera de Europa, incl. Georgia) -> "Otros".
    var excl = { 'España': 1, 'Espana': 1 }; NOID_KEYS.forEach(function (k) { excl[k] = 1; });
    var euro = [], otros = 0;
    Object.keys(nac).forEach(function (k) {
      if (excl[k]) return;
      if (LPR_EUROPA[k]) euro.push([k, nac[k]]); else otros += nac[k];
    });
    euro.sort(function (a, b) { return b[1] - a[1]; });
    var top = euro.slice(0, 11);
    if (otros > 0) top.push(['Otros (fuera de Europa)', otros]);
    top.sort(function (a, b) { return b[1] - a[1]; });
    if (top.length) { set('lpr-kpi-pais-top', top[0][0]); set('lpr-kpi-pais-top-sub', multiNf(top[0][1]) + ' vehículos'); }
    var opts = chartCartesianOptions();
    multiDestroy('lprNacIntl');
    var c1 = document.getElementById('chart-lpr-nacintl');
    if (c1) multiCharts.lprNacIntl = new Chart(c1, { type: 'doughnut', data: { labels: ['Nacionales (España)', 'Internacionales', 'No identificadas'], datasets: [{ data: [esp, intl, noId], backgroundColor: ['#2563eb', '#f59e0b', '#cbd5e1'] }] }, options: chartRadialOptions({ cutout: '60%' }) });
    multiDestroy('lprPaises');
    var c2 = document.getElementById('chart-lpr-paises');
    if (c2) multiCharts.lprPaises = new Chart(c2, { type: 'bar', data: { labels: top.map(function (e) { return e[0]; }), datasets: [{ label: 'Vehículos', data: top.map(function (e) { return e[1]; }), backgroundColor: '#f59e0b', borderRadius: BARRA_RADIO }] }, options: Object.assign({ indexAxis: 'y' }, opts) });
  }

  var LPR_COLOR_MAP = { 'White': '#e5e7eb', 'Blanco': '#e5e7eb', 'Negro': '#111827', 'Black': '#111827', 'Gris': '#9ca3af', 'Gray': '#9ca3af', 'Grey': '#9ca3af', 'Rojo': '#ef4444', 'Red': '#ef4444', 'Azul': '#3b82f6', 'Blue': '#3b82f6', 'Verde': '#22c55e', 'Green': '#22c55e', 'Amarillo': '#eab308', 'Yellow': '#eab308', 'Marrón': '#92400e', 'Marron': '#92400e', 'Naranja': '#f97316', 'Plata': '#d1d5db', 'Silver': '#d1d5db', 'Cian': '#06b6d4', 'Morado': '#a855f7', 'Rosa': '#ec4899' };
  // Lista-ranking reutilizable: entries = [[nombre, valor], ...]
  function lprRankList(id, entries, opts) {
    var ol = document.getElementById(id); if (!ol) return;
    opts = opts || {};
    var total = entries.reduce(function (s, e) { return s + e[1]; }, 0) || 1;
    var max = entries.length ? entries[0][1] : 1;
    ol.innerHTML = '';
    if (!entries.length) { ol.innerHTML = '<li style="color:#94a3b8;font-size:.85rem">Sin datos para el periodo.</li>'; return; }
    entries.forEach(function (e, i) {
      var pct = max ? Math.round(e[1] / max * 100) : 0;
      var pctTot = (e[1] / total * 100).toFixed(1);
      var barCol = opts.colorFn ? opts.colorFn(e[0]) : (opts.bar || '#2563eb');
      var swatch = opts.colorFn ? '<span style="display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid #cbd5e1;background:' + barCol + ';margin-right:6px;vertical-align:middle"></span>' : '<b style="color:#cbd5e1;margin-right:5px">' + (i + 1) + '.</b>';
      var li = document.createElement('li');
      li.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:3px"><span style="font-size:.85rem;color:#334155">' + swatch + e[0] + '</span><span style="font-size:.82rem;font-weight:600;color:#0f172a">' + multiNf(e[1]) + ' <span style="color:#94a3b8;font-weight:400">(' + pctTot + '%)</span></span></div><div style="height:7px;background:#eef2f7;border-radius:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + barCol + ';border-radius:6px"></div></div>';
      ol.appendChild(li);
    });
  }
  function renderLprColores() {
    var agg = lprDimAgg();
    var ord = function (o, n) { var e = Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); return n ? e.slice(0, n) : e; };
    lprRankList('lpr-list-color', ord(agg.color), { colorFn: function (k) { return LPR_COLOR_MAP[k] || '#a78bfa'; } });
    lprRankList('lpr-list-tipo', ord(agg.tipo), { bar: '#0ea5e9' });
    lprRankList('lpr-list-marca', ord(agg.marca, 15), { bar: '#8b5cf6' });
  }

  // Filtros año/mes para las vistas LPR
  function lprAnios() { return Object.keys(lprClavesMes().reduce(function (a, m) { a[m.slice(0, 4)] = 1; return a; }, {})).sort(); }
  function lprPoblarMeses() {
    var sel = document.getElementById('lpr-f-mes'); if (!sel) return;
    var anio = (document.getElementById('lpr-f-anio') || {}).value || '';
    var meses = lprClavesMes().filter(function (m) { return !anio || m.slice(0, 4) === anio; }).sort();
    var prev = sel.value;
    sel.innerHTML = ''; sel.appendChild(new Option('Todos los meses', ''));
    // Sin año selecciondo puede haber meses repetidos (2 años): solo entonces añade el año para distinguir.
    meses.forEach(function (m) {
      var etq = anio ? (MESES[parseInt(m.slice(5, 7), 10) - 1] || m) : mesEtiqueta(m);
      sel.appendChild(new Option(etq, m));
    });
    sel.value = (prev && meses.indexOf(prev) >= 0) ? prev : '';
  }
  function lprPoblarCamaras() {
    var sel = document.getElementById('lpr-f-cam'); if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = ''; sel.appendChild(new Option('Todas las cámaras', ''));
    lprCamaras().forEach(function (c) { sel.appendChild(new Option(lprNombre(c), c)); });
    if (prev) sel.value = prev;
  }
  function initLprFiltros() {
    var anioSel = document.getElementById('lpr-f-anio'); if (!anioSel) return;
    var prevA = anioSel.value;
    anioSel.innerHTML = ''; anioSel.appendChild(new Option('Todos los años', ''));
    lprAnios().forEach(function (a) { anioSel.appendChild(new Option(a, a)); });
    if (prevA) anioSel.value = prevA;
    lprPoblarMeses();
    lprPoblarCamaras();
    if (!anioSel._bound) { anioSel.addEventListener('change', function () { lprPoblarMeses(); renderAllLpr(); }); anioSel._bound = true; }
    var mesSel = document.getElementById('lpr-f-mes');
    if (mesSel && !mesSel._bound) { mesSel.addEventListener('change', renderAllLpr); mesSel._bound = true; }
    var dirSel = document.getElementById('lpr-f-dir');
    if (dirSel && !dirSel._bound) { dirSel.addEventListener('change', renderAllLpr); dirSel._bound = true; }
    var camSel = document.getElementById('lpr-f-cam');
    if (camSel && !camSel._bound) { camSel.addEventListener('change', renderAllLpr); camSel._bound = true; }
    // Estado inicial (sección activa por defecto = accesos: Sentido visible, Cámara oculta)
    var dw = document.getElementById('lpr-f-dir-wrap'); if (dw) dw.style.display = '';
    var cw = document.getElementById('lpr-f-cam-wrap'); if (cw) cw.style.display = 'none';
  }
  function renderAllLpr() {
    renderLprResumen();
    renderLprEvolucion();
    renderLprHorario();
    renderLprProcedencia();
    renderLprColores();
    if (mapaLpr) setTimeout(function () { if (mapaLpr) mapaLpr.invalidateSize(true); }, 80);
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

  // Ajusta la escala de la letra/espaciado del nav para que TODOS los ítems quepan sin barra de scroll.
  function fitNav(navEl) {
    // Nombres a tamaño estándar siempre; si el menú es largo, hace scroll (CSS).
    if (!navEl) return;
    navEl.style.setProperty('--nav-scale', '1');
  }
  var _navResizeBound = false;
  function bindNavResize() {
    if (_navResizeBound) return; _navResizeBound = true;
    window.addEventListener('resize', function () {
      var nv = document.querySelector('.sidebar .nav[data-active="1"]');
      if (nv) fitNav(nv);
    });
  }
  function setMode(newMode) {
    mode = newMode;
    const mainLanding = document.getElementById('main-landing');
    const mainResiduos = document.getElementById('main-residuos');
    const mainCamaras = document.getElementById('main-camaras');
    const mainTurismo = document.getElementById('main-turismo');
    const mainRedes = document.getElementById('main-redes');
    const headerResiduos = document.getElementById('header-residuos');
    const headerCamaras = document.getElementById('header-camaras');
    const headerTurismo = document.getElementById('header-turismo');
    const headerRedes = document.getElementById('header-redes');
    const navResiduos = document.getElementById('nav-residuos');
    const navCamaras = document.getElementById('nav-camaras');
    const navTurismo = document.getElementById('nav-turismo');
    const navRedes = document.getElementById('nav-redes');
    const footer = document.getElementById('sidebar-footer');
    const sidebar = document.querySelector('.sidebar');
    // Ocultar todo
    if (mainLanding) mainLanding.style.display = 'none';
    if (mainResiduos) mainResiduos.style.display = 'none';
    if (mainCamaras) mainCamaras.style.display = 'none';
    if (mainTurismo) mainTurismo.style.display = 'none';
    if (mainRedes) mainRedes.style.display = 'none';
    if (headerResiduos) headerResiduos.style.display = 'none';
    if (headerCamaras) headerCamaras.style.display = 'none';
    if (headerTurismo) headerTurismo.style.display = 'none';
    if (headerRedes) headerRedes.style.display = 'none';
    if (navResiduos) navResiduos.style.display = 'none';
    if (navCamaras) navCamaras.style.display = 'none';
    if (navTurismo) navTurismo.style.display = 'none';
    if (navRedes) navRedes.style.display = 'none';
    // Mostrar/ocultar los botones de cambio según el modo activo (el del modo actual se oculta)
    const btnCamaras = document.getElementById('mode-to-camaras');
    const btnResiduos = document.getElementById('mode-to-residuos');
    const btnTurismo = document.getElementById('mode-to-turismo');
    const btnRedes = document.getElementById('mode-to-redes');
    if (btnCamaras) btnCamaras.style.display = mode === 'camaras' ? 'none' : 'block';
    if (btnResiduos) btnResiduos.style.display = mode === 'residuos' ? 'none' : 'block';
    if (btnTurismo) btnTurismo.style.display = mode === 'turismo' ? 'none' : 'block';
    if (btnRedes) btnRedes.style.display = mode === 'redes' ? 'none' : 'block';
    // Modo landing: ocultar sidebar y mostrar solo la pantalla de selección
    if (mode === 'landing') {
      if (sidebar) sidebar.style.display = 'none';
      if (mainLanding) mainLanding.style.display = 'block';
      return;
    }
    if (sidebar) sidebar.style.display = 'flex';
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
    } else if (mode === 'redes') {
      if (mainRedes) mainRedes.style.display = 'block';
      if (headerRedes) headerRedes.style.display = 'flex';
      if (navRedes) navRedes.style.display = 'block';
      if (footer) footer.textContent = 'Redes y web';
      setTimeout(function () { if (typeof ensureRedesLoaded === 'function') ensureRedesLoaded().then(() => renderRedesAll()).catch(() => {}); }, 50);
    } else {
      if (mainCamaras) mainCamaras.style.display = 'block';
      if (headerCamaras) headerCamaras.style.display = 'flex';
      if (navCamaras) navCamaras.style.display = 'block';
      if (footer) footer.textContent = 'Cámaras de tráfico';
      setTimeout(function () { invalidateMapaCamaras(); }, 120);
    }
    // Ajusta la letra del nav activo para que quepa sin barra de scroll
    var activeNav = mode === 'residuos' ? navResiduos : mode === 'turismo' ? navTurismo : mode === 'redes' ? navRedes : mode === 'camaras' ? navCamaras : null;
    [navResiduos, navTurismo, navRedes, navCamaras].forEach(function (n) { if (n) n.removeAttribute('data-active'); });
    if (activeNav) { activeNav.setAttribute('data-active', '1'); bindNavResize(); setTimeout(function () { fitNav(activeNav); }, 70); }
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

  // ====== Grandes productores (FOBESA: pesajes por hotel/camping y fracción) ======
  var _gpData = null;
  var _gpCharts = {};
  var _gpFiltrosInit = false;
  function gpMesLbl(ym) {
    var p = String(ym).split('-');
    return (MESES[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0];
  }
  function gpFmtKg(n) { return (Math.round(n || 0)).toLocaleString('es-ES') + ' kg'; }
  function gpDestroy(k) { if (_gpCharts[k]) { _gpCharts[k].destroy(); _gpCharts[k] = null; } }
  function gpAgg(meses, estab) {
    // Suma fracciones sobre la lista de meses dada. estab='' = todos los establecimientos.
    meses = meses || _gpData.meses;
    var porEstab = {};
    var totalFrac = { envases: 0, organica: 0, papel: 0 };
    meses.forEach(function (m) {
      var dm = _gpData.datos[m] || {};
      Object.keys(dm).forEach(function (e) {
        if (estab && e !== estab) return;
        var d = dm[e];
        if (!porEstab[e]) porEstab[e] = { envases: 0, organica: 0, papel: 0, total: 0 };
        porEstab[e].envases += d.envases; porEstab[e].organica += d.organica; porEstab[e].papel += d.papel; porEstab[e].total += d.total;
        totalFrac.envases += d.envases; totalFrac.organica += d.organica; totalFrac.papel += d.papel;
      });
    });
    var total = totalFrac.envases + totalFrac.organica + totalFrac.papel;
    return { porEstab: porEstab, totalFrac: totalFrac, total: total, nMeses: meses.length };
  }
  function renderGrandesProductores() {
    var render = function () {
      if (!_gpData || !_gpData.meses || !_gpData.meses.length) return;
      // Selectores
      var selAnio = document.getElementById('gp-anio');
      var selMes = document.getElementById('gp-mes');
      var selEstab = document.getElementById('gp-estab');
      var gpMesNombre = function (ym) { return MESES[parseInt(String(ym).split('-')[1], 10) - 1] || ym; };
      // Rellena el desplegable de meses según el año elegido (solo nombre del mes).
      var rellenaMeses = function (anioSel, keep) {
        if (!selMes) return;
        var lista = _gpData.meses.filter(function (m) { return !anioSel || m.split('-')[0] === anioSel; });
        selMes.innerHTML = '<option value="">Todos los meses</option>' + lista.slice().reverse().map(function (m) { return '<option value="' + m + '">' + gpMesNombre(m) + '</option>'; }).join('');
        if (keep && lista.indexOf(keep) >= 0) selMes.value = keep;
      };
      if (!_gpFiltrosInit && selAnio && selMes && selEstab) {
        var anios = Array.from(new Set(_gpData.meses.map(function (m) { return m.split('-')[0]; }))).sort();
        selAnio.innerHTML = '<option value="">Todos los años</option>' + anios.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
        rellenaMeses('', '');
        selEstab.innerHTML = '<option value="">Todos los establecimientos</option>' + _gpData.establecimientos.map(function (e) { return '<option value="' + e.replace(/"/g, '&quot;') + '">' + e + '</option>'; }).join('');
        selAnio.addEventListener('change', function () { rellenaMeses(selAnio.value, ''); render(); });
        selMes.addEventListener('change', render);
        selEstab.addEventListener('change', render);
        _gpFiltrosInit = true;
      }
      var anio = selAnio ? selAnio.value : '';
      var mes = selMes ? selMes.value : '';
      var estab = selEstab ? selEstab.value : '';
      // Meses activos según año/mes seleccionados.
      var mesesActivos = mes ? [mes] : _gpData.meses.filter(function (m) { return !anio || m.split('-')[0] === anio; });
      var per = document.getElementById('gp-periodo');
      if (per) per.textContent = (mesesActivos.length ? (mesesActivos.length === 1 ? gpMesLbl(mesesActivos[0]) : gpMesLbl(mesesActivos[0]) + ' – ' + gpMesLbl(mesesActivos[mesesActivos.length - 1])) : '—') + ' · actualizado ' + (_gpData.actualizado || '');
      var ag = gpAgg(mesesActivos, estab);
      var entries = Object.entries(ag.porEstab).sort(function (a, b) { return b[1].total - a[1].total; });
      var pct = function (v) { return ag.total ? (100 * v / ag.total).toFixed(1).replace('.', ',') + ' %' : '0 %'; };
      // KPIs
      var cont = document.getElementById('gp-kpis');
      if (cont) cont.innerHTML = [
        { l: 'Total recogido', v: gpFmtKg(ag.total), sub: estab || (entries.length + ' establecimientos') },
        { l: 'Orgánica', v: gpFmtKg(ag.totalFrac.organica), sub: pct(ag.totalFrac.organica) },
        { l: 'Envases mezclados', v: gpFmtKg(ag.totalFrac.envases), sub: pct(ag.totalFrac.envases) },
        { l: 'Papel/Cartón', v: gpFmtKg(ag.totalFrac.papel), sub: pct(ag.totalFrac.papel) },
        { l: mesesActivos.length === 1 ? 'Establecimientos' : 'Media mensual', v: mesesActivos.length === 1 ? String(entries.length) : gpFmtKg(ag.total / (ag.nMeses || 1)), sub: mesesActivos.length === 1 ? 'con datos' : ag.nMeses + ' meses' }
      ].map(function (it) { return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + it.l + '</span><span class="turismo-mini-kpi-value">' + it.v + '</span><span class="turismo-mini-kpi-sub">' + it.sub + '</span></div>'; }).join('');
      // Ranking (respeta año/mes; ignora estab para no dejar una sola barra)
      var agRank = gpAgg(mesesActivos, '');
      var rank = Object.entries(agRank.porEstab).sort(function (a, b) { return b[1].total - a[1].total; });
      gpDestroy('ranking');
      var cR = document.getElementById('chart-gp-ranking');
      if (cR) _gpCharts['ranking'] = new Chart(cR, {
        type: 'bar',
        data: {
          labels: rank.map(function (e) { return e[0].length > 26 ? e[0].slice(0, 26) + '…' : e[0]; }),
          datasets: [
            { label: 'Orgánica', data: rank.map(function (e) { return Math.round(e[1].organica); }), backgroundColor: '#16a34a' },
            { label: 'Envases', data: rank.map(function (e) { return Math.round(e[1].envases); }), backgroundColor: '#f59e0b' },
            { label: 'Papel/Cartón', data: rank.map(function (e) { return Math.round(e[1].papel); }), backgroundColor: '#2563eb' }
          ]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { callback: function (v) { return (v / 1000) + ' t'; } } }, y: { stacked: true } }, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + gpFmtKg(c.raw); } } } } }
      });
      // Fracción doughnut
      gpDestroy('fraccion');
      var cF = document.getElementById('chart-gp-fraccion');
      if (cF) _gpCharts['fraccion'] = new Chart(cF, {
        type: 'doughnut',
        data: { labels: ['Orgánica', 'Envases mezclados', 'Papel/Cartón'], datasets: [{ data: [Math.round(ag.totalFrac.organica), Math.round(ag.totalFrac.envases), Math.round(ag.totalFrac.papel)], backgroundColor: ['#16a34a', '#f59e0b', '#2563eb'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + gpFmtKg(c.raw); } } } } }
      });
      // Evolución mensual (respeta año y estab; ignora el mes concreto)
      gpDestroy('evolucion');
      var evolMeses = _gpData.meses.filter(function (m) { return !anio || m.split('-')[0] === anio; });
      var cE = document.getElementById('chart-gp-evolucion');
      if (cE) _gpCharts['evolucion'] = new Chart(cE, {
        type: 'line',
        data: {
          labels: evolMeses.map(gpMesLbl),
          datasets: [{ label: 'kg totales' + (estab ? ' · ' + estab : ''), data: evolMeses.map(function (m) { return Math.round(gpAgg([m], estab).total); }), borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.15)', fill: true, tension: 0.3, pointRadius: 3 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return gpFmtKg(c.raw); } } } }, scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return (v / 1000) + ' t'; } } } } }
      });
      // Tabla
      var tb = document.getElementById('gp-tabla');
      if (tb) {
        var html = '<table class="residuos-data-table"><thead><tr><th>Establecimiento</th><th>Orgánica</th><th>Envases</th><th>Papel/Cartón</th><th>Total</th></tr></thead><tbody>';
        entries.forEach(function (e) { var d = e[1]; html += '<tr><td>' + e[0].replace(/</g, '&lt;') + '</td><td>' + gpFmtKg(d.organica) + '</td><td>' + gpFmtKg(d.envases) + '</td><td>' + gpFmtKg(d.papel) + '</td><td><strong>' + gpFmtKg(d.total) + '</strong></td></tr>'; });
        html += '</tbody></table>';
        tb.innerHTML = html;
      }
    };
    if (_gpData) { render(); return; }
    var url = (typeof dataUrl === 'function') ? dataUrl('data/RESIDUOS/grandes_productores.json') : '/data/RESIDUOS/grandes_productores.json';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { _gpData = d; render(); }).catch(function () {});
  }

  /** Tab "Grandes productores" de la vista Tablas: pivote establecimiento × mes (kg). */
  function renderTablasGrandes(content, esc) {
    if (!content) return;
    var pintar = function () {
      var meses = _gpData.meses;
      var tot = Object.entries(_gpData.totalesEstab).sort(function (a, b) { return b[1].total - a[1].total; });
      var kg = function (n) { return (Math.round(n || 0)).toLocaleString('es-ES'); };
      var html = '<div style="overflow:auto;max-height:70vh;border:1px solid #e2e8f0;border-radius:8px"><table class="residuos-data-table" style="min-width:100%"><thead><tr><th style="position:sticky;left:0;background:#1e293b;color:#fff">Establecimiento</th>' + meses.map(function (m) { return '<th>' + gpMesLbl(m) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
      tot.forEach(function (row) {
        var e = row[0];
        html += '<tr><td style="position:sticky;left:0;background:#fff;font-weight:600">' + esc(e) + '</td>' + meses.map(function (m) { var d = (_gpData.datos[m] || {})[e]; return '<td>' + (d ? kg(d.total) : '—') + '</td>'; }).join('') + '<td><strong>' + kg(row[1].total) + '</strong></td></tr>';
      });
      html += '<tr style="border-top:2px solid #cbd5e1;font-weight:700"><td style="position:sticky;left:0;background:#f1f5f9">TOTAL</td>' + meses.map(function (m) { return '<td>' + kg((_gpData.totalesMes[m] || {}).total) + '</td>'; }).join('') + '<td>' + kg(tot.reduce(function (s, r) { return s + r[1].total; }, 0)) + '</td></tr>';
      html += '</tbody></table></div><p class="residuos-tablas-hint" style="margin-top:.5rem">Kg por establecimiento y mes · Fuente: FOBESA (grandes productores) · actualizado ' + (_gpData.actualizado || '') + '</p>';
      content.innerHTML = html;
    };
    if (_gpData) { pintar(); return; }
    content.innerHTML = '<p class="residuos-section-placeholder">Cargando…</p>';
    var url = (typeof dataUrl === 'function') ? dataUrl('data/RESIDUOS/grandes_productores.json') : '/data/RESIDUOS/grandes_productores.json';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { _gpData = d; pintar(); }).catch(function () { content.innerHTML = '<p class="residuos-section-placeholder">No se pudieron cargar los datos.</p>'; });
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
        '<div class="tablas-card' + (tablasVistaActiva === 'grandes' ? ' active' : '') + '" data-vista="grandes">' +
          '<div class="tablas-card-icon">🧾</div>' +
          '<div class="tablas-card-body">' +
            '<div class="tablas-card-title">Grandes productores</div>' +
            '<div class="tablas-card-desc">Pesajes FOBESA por hotel/camping y mes (kg)</div>' +
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
    } else if (tablasVistaActiva === 'grandes') {
      renderTablasGrandes(content, esc);
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
    if (target && ['camaras', 'residuos', 'turismo', 'redes'].indexOf(target) >= 0) { setMode(target); return; }
    const next = mode === 'camaras' ? 'residuos' : mode === 'residuos' ? 'turismo' : mode === 'turismo' ? 'redes' : 'camaras';
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

  /* ============================ INFORMES (por módulo) ============================ */
  var _infState = {}; // por ámbito: { charts:{}, bound:bool, data:{} }
  function infSt(amb) { return _infState[amb] || (_infState[amb] = { charts: {}, bound: false, data: null }); }
  function infIds(amb) { return { anio: 'inf-' + amb + '-anio', mes: 'inf-' + amb + '-mes', generar: 'inf-' + amb + '-generar', imprimir: 'inf-' + amb + '-imprimir', estado: 'inf-' + amb + '-estado', salida: 'inf-' + amb + '-salida' }; }
  function infMesNombre(m) { return MESES[(+m) - 1] || m; }
  function infFmt(n) { if (n == null || isNaN(n)) return '—'; return Math.round(n).toLocaleString('es-ES'); }
  function infEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function infPct(a, b) { if (a == null || b == null || !b) return null; return ((a - b) / b) * 100; }
  function infPeriodoLabel(anio, mes) { return (mes ? infMesNombre(mes) + ' ' : '') + anio; }
  // ---- rango de días (solo Cámaras: aforo + LPR tienen datos diarios) ----
  function infParseISO(s) { var p = String(s).split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function infISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function infShiftISO(iso, days) { var d = infParseISO(iso); d.setDate(d.getDate() + days); return infISO(d); }
  function infShiftAnioISO(iso, yrs) { var d = infParseISO(iso); d.setFullYear(d.getFullYear() + yrs); return infISO(d); }
  function infDiasEntre(desde, hasta) { return Math.round((infParseISO(hasta) - infParseISO(desde)) / 86400000) + 1; }
  function infDiaCorto(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }
  function infRangoLabel(desde, hasta) {
    var a = infParseISO(desde), b = infParseISO(hasta);
    if (desde === hasta) return a.getDate() + ' ' + infMesNombre(a.getMonth() + 1) + ' ' + a.getFullYear();
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return a.getDate() + '–' + b.getDate() + ' ' + infMesNombre(b.getMonth() + 1) + ' ' + b.getFullYear();
    if (a.getFullYear() === b.getFullYear()) return a.getDate() + ' ' + infMesNombre(a.getMonth() + 1) + ' – ' + b.getDate() + ' ' + infMesNombre(b.getMonth() + 1) + ' ' + b.getFullYear();
    return a.getDate() + ' ' + infMesNombre(a.getMonth() + 1) + ' ' + a.getFullYear() + ' – ' + b.getDate() + ' ' + infMesNombre(b.getMonth() + 1) + ' ' + b.getFullYear();
  }
  function infAmbitoTitulo(a) { return { turismo: 'Informe de Turismo', residuos: 'Informe de Residuos', camaras: 'Informe de Cámaras' }[a] || 'Informe'; }

  function infEnsure(ambito) {
    if (ambito === 'turismo') return (typeof ensureTurismoLoaded === 'function') ? ensureTurismoLoaded() : Promise.resolve();
    if (ambito === 'residuos') return (typeof loadAllData === 'function') ? loadAllData().catch(function () {}) : Promise.resolve();
    if (ambito === 'camaras') {
      var pc = camarasData ? Promise.resolve(camarasData) : fetch('/api/camaras/dashboard', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { camarasData = d; return d; });
      return Promise.all([pc, (typeof sitLoad === 'function') ? sitLoad() : Promise.resolve()]).then(function (a) { return a[0]; });
    }
    return Promise.resolve();
  }
  function infAnios(ambito) {
    var set = new Set();
    if (ambito === 'turismo' && turismoData) ['hoteles', 'apartamentos', 'campings'].forEach(function (cat) { (turismoData.series[cat] || []).forEach(function (s) { (s.data || []).forEach(function (d) { set.add(String(d.anyo)); }); }); });
    else if (ambito === 'camaras' && camarasData) { var es = (camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {}; Object.keys(es).forEach(function (k) { set.add(k.slice(0, 4)); }); }
    else if (ambito === 'residuos') (dataCamion || []).forEach(function (r) { if (r.fecha) set.add(String(r.fecha).slice(0, 4)); });
    return Array.from(set).filter(Boolean).sort();
  }
  function infMeses(ambito, anio) {
    var set = new Set();
    if (ambito === 'turismo' && turismoData) ['hoteles', 'apartamentos', 'campings'].forEach(function (cat) { (turismoData.series[cat] || []).forEach(function (s) { (s.data || []).forEach(function (d) { if (String(d.anyo) === String(anio) && d.mes) set.add(+d.mes); }); }); });
    else if (ambito === 'camaras' && camarasData) { var es = (camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {}; Object.keys(es).forEach(function (k) { if (k.slice(0, 4) === String(anio)) set.add(parseInt(k.slice(5), 10)); }); }
    else if (ambito === 'residuos') (dataCamion || []).forEach(function (r) { if (r.fecha && String(r.fecha).slice(0, 4) === String(anio)) set.add(parseInt(String(r.fecha).slice(5, 7), 10)); });
    return Array.from(set).filter(Boolean).sort(function (a, b) { return a - b; });
  }

  // ---- ensambladores por ámbito ----
  function infTurSerie(cat, met, anio) { var s = (turismoData.series[cat] || []).find(function (x) { return x.metrica === met; }); var o = {}; if (s) s.data.forEach(function (d) { if (String(d.anyo) === String(anio)) o[+d.mes] = d.valor; }); return o; }
  function infTurVal(cat, met, anio, mes) { var m = infTurSerie(cat, met, anio); if (mes) return m[+mes] != null ? m[+mes] : null; var v = Object.values(m).filter(function (x) { return x != null; }); if (!v.length) return null; return met === 'grado_ocupacion' ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : v.reduce(function (a, b) { return a + b; }, 0); }
  function infCompSpec(comp) { return { tipo: 'bar', labels: comp.map(function (c) { return c.label; }), datasets: [{ label: 'Actual', data: comp.map(function (c) { return c.actual; }), color: '#2563eb' }, { label: 'Mes anterior', data: comp.map(function (c) { return c.mesAnterior; }), color: '#93c5fd' }, { label: 'Año anterior', data: comp.map(function (c) { return c.anioAnterior; }), color: '#f59e0b' }] }; }
  function infTurAnual(cat, met) { var s = (turismoData.series[cat] || []).find(function (x) { return x.metrica === met; }); var by = {}; if (s) s.data.forEach(function (d) { by[d.anyo] = (by[d.anyo] || 0) + (d.valor || 0); }); var years = Object.keys(by).sort().slice(-8); return { years: years, vals: years.map(function (y) { return Math.round(by[y]); }) }; }
  function infTurProcedencia(anio, mes) {
    var proc = (turismoData.series.procedencia || []).filter(function (s) { return s.residencia === 'ccaa' && s.nombre !== 'Total Nacional'; });
    return proc.map(function (s) { var v = (s.data || []).filter(function (d) { return String(d.anyo) === String(anio) && (!mes || +d.mes === +mes); }).reduce(function (a, b) { return a + (b.valor || 0); }, 0); return { n: s.nombre, v: Math.round(v) }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
  }
  function infBuildTurismo(anio, mes) {
    var prev = String(+anio - 1);
    var cmp = function (cat, met, label) {
      var act = infTurVal(cat, met, anio, mes), ma = null, aa = infTurVal(cat, met, prev, mes);
      if (mes) { var pm = (+mes) - 1; ma = pm >= 1 ? infTurVal(cat, met, anio, pm) : infTurVal(cat, met, prev, 12); }
      return { label: label, actual: act, mesAnterior: ma, anioAnterior: aa, varMes: infPct(act, ma), varAnio: infPct(act, aa) };
    };
    var comp = [cmp('hoteles', 'viajeros', 'Viajeros hoteles'), cmp('hoteles', 'pernoctaciones', 'Pernoctaciones'), cmp('hoteles', 'grado_ocupacion', 'Ocupación %'), cmp('hoteles', 'adr', 'Tarifa media (ADR)')];
    var graficas = [];
    var addLine = function (key, titulo, cat, met, color) { var s = infTurSerie(cat, met, anio); var mo = Object.keys(s).map(Number).sort(function (a, b) { return a - b; }); if (mo.length && mo.some(function (m) { return s[m] != null; })) graficas.push({ key: key, titulo: titulo, spec: { tipo: 'line', labels: mo.map(infMesNombre), datasets: [{ label: titulo, data: mo.map(function (m) { return s[m]; }), color: color }] } }); };
    addLine('viajeros_mes', 'Viajeros en hoteles por mes (' + anio + ')', 'hoteles', 'viajeros', '#2563eb');
    addLine('pernoctaciones_mes', 'Pernoctaciones en hoteles por mes (' + anio + ')', 'hoteles', 'pernoctaciones', '#7c3aed');
    addLine('ocupacion_mes', 'Ocupación hotelera por mes % (' + anio + ')', 'hoteles', 'grado_ocupacion', '#0891b2');
    addLine('adr_mes', 'Tarifa media (ADR) por mes € (' + anio + ')', 'hoteles', 'adr', '#d97706');
    addLine('revpar_mes', 'RevPAR por mes € (' + anio + ')', 'hoteles', 'revpar', '#db2777');
    graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: infCompSpec(comp) });
    var tipo = [{ n: 'Hoteles', v: infTurVal('hoteles', 'viajeros', anio, mes) }, { n: 'Apartamentos', v: infTurVal('apartamentos', 'viajeros', anio, mes) }, { n: 'Campings', v: infTurVal('campings', 'viajeros', anio, mes) }].filter(function (x) { return x.v != null; });
    if (tipo.length) graficas.push({ key: 'viajeros_por_tipo', titulo: 'Viajeros por tipo de alojamiento', spec: { tipo: 'bar', labels: tipo.map(function (i) { return i.n; }), datasets: [{ label: 'Viajeros', data: tipo.map(function (i) { return i.v; }), color: '#0ea5e9' }] } });
    var ocup = [{ n: 'Hoteles', v: infTurVal('hoteles', 'grado_ocupacion', anio, mes) }, { n: 'Apartamentos', v: infTurVal('apartamentos', 'grado_ocupacion', anio, mes) }, { n: 'Campings', v: infTurVal('campings', 'grado_ocupacion', anio, mes) }].filter(function (x) { return x.v != null; });
    if (ocup.length) graficas.push({ key: 'ocupacion_por_tipo', titulo: 'Grado de ocupación por tipo (%)', spec: { tipo: 'bar', labels: ocup.map(function (i) { return i.n; }), datasets: [{ label: 'Ocupación %', data: ocup.map(function (i) { return Math.round(i.v * 10) / 10; }), color: '#0891b2' }] } });
    var proc = infTurProcedencia(anio, mes);
    if (proc.length) graficas.push({ key: 'procedencia_ccaa', titulo: 'Procedencia nacional de los turistas (top CCAA)', spec: { tipo: 'barH', labels: proc.map(function (i) { return i.n; }), datasets: [{ label: 'Turistas', data: proc.map(function (i) { return i.v; }), color: '#7c3aed' }] } });
    var an = infTurAnual('hoteles', 'viajeros'); if (an.years.length > 1) graficas.push({ key: 'viajeros_anual', titulo: 'Viajeros en hoteles por año', spec: { tipo: 'bar', labels: an.years, datasets: [{ label: 'Viajeros', data: an.vals, color: '#16a34a' }] } });
    return {
      kpis: [
        { label: 'Viajeros hoteles', valor: infTurVal('hoteles', 'viajeros', anio, mes), comp: comp[0] },
        { label: 'Pernoctaciones hoteles', valor: infTurVal('hoteles', 'pernoctaciones', anio, mes), comp: comp[1] },
        { label: 'Ocupación hotelera', valor: infTurVal('hoteles', 'grado_ocupacion', anio, mes), unidad: '%', comp: comp[2] },
        { label: 'Tarifa media (ADR)', valor: infTurVal('hoteles', 'adr', anio, mes), unidad: '€', comp: comp[3] },
        { label: 'Estancia media', valor: infTurVal('hoteles', 'estancia_media', anio, mes), unidad: 'noches' },
        { label: 'Viajeros apartamentos', valor: infTurVal('apartamentos', 'viajeros', anio, mes) },
        { label: 'Viajeros campings', valor: infTurVal('campings', 'viajeros', anio, mes) }
      ],
      comparativa: comp,
      graficas: graficas
    };
  }
  function infResMes(anio, mes) { var pref = mes ? (anio + '-' + String(mes).padStart(2, '0')) : String(anio); var kg = 0, sal = 0, f = false; (dataCamion || []).forEach(function (r) { if (r.fecha && String(r.fecha).indexOf(pref) === 0) { kg += (+r.kg || 0); sal += (+r.salidas || 0); f = true; } }); return f ? { kg: kg, salidas: sal } : null; }
  function infResAnual() { var by = {}; (dataCamion || []).forEach(function (r) { if (r.fecha) { var y = String(r.fecha).slice(0, 4); by[y] = (by[y] || 0) + (+r.kg || 0); } }); var years = Object.keys(by).sort().slice(-8); return { years: years, vals: years.map(function (y) { return Math.round(by[y]); }) }; }
  function infBuildResiduos(anio, mes) {
    var cur = infResMes(anio, mes) || { kg: null, salidas: null }, prev = String(+anio - 1), ma = null;
    if (mes) { var pm = (+mes) - 1; ma = pm >= 1 ? infResMes(anio, pm) : infResMes(prev, 12); }
    var aa = infResMes(prev, mes);
    var serie = {}; (dataCamion || []).forEach(function (r) { if (r.fecha && String(r.fecha).slice(0, 4) === String(anio)) { var m = parseInt(String(r.fecha).slice(5, 7), 10); serie[m] = { kg: (+r.kg || 0), salidas: (+r.salidas || 0) }; } });
    var mo = Object.keys(serie).map(Number).sort(function (a, b) { return a - b; });
    var comp = [
      { label: 'Kg recogidos', actual: cur.kg, mesAnterior: ma ? ma.kg : null, anioAnterior: aa ? aa.kg : null, varMes: infPct(cur.kg, ma && ma.kg), varAnio: infPct(cur.kg, aa && aa.kg) },
      { label: 'Salidas', actual: cur.salidas, mesAnterior: ma ? ma.salidas : null, anioAnterior: aa ? aa.salidas : null, varMes: infPct(cur.salidas, ma && ma.salidas), varAnio: infPct(cur.salidas, aa && aa.salidas) }
    ];
    var graficas = [];
    if (mo.length) {
      graficas.push({ key: 'kg_mes', titulo: 'Kg recogidos por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map(infMesNombre), datasets: [{ label: 'Kg', data: mo.map(function (m) { return serie[m].kg; }), color: '#2563eb' }] } });
      graficas.push({ key: 'salidas_mes', titulo: 'Salidas del camión por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map(infMesNombre), datasets: [{ label: 'Salidas', data: mo.map(function (m) { return serie[m].salidas; }), color: '#f59e0b' }] } });
    }
    graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: infCompSpec(comp) });
    var frac = { envases: 0, organica: 0, papel: 0 }, gpTotal = 0, gpItems = [];
    if (typeof _gpData !== 'undefined' && _gpData && _gpData.datos) {
      var claves = mes ? [anio + '-' + String(mes).padStart(2, '0')] : (_gpData.meses || []).filter(function (k) { return k.slice(0, 4) === String(anio); });
      var acc = {}; claves.forEach(function (k) { var dm = _gpData.datos[k] || {}; Object.keys(dm).forEach(function (e) { var d = dm[e]; acc[e] = (acc[e] || 0) + d.total; frac.envases += d.envases || 0; frac.organica += d.organica || 0; frac.papel += d.papel || 0; }); });
      gpItems = Object.entries(acc).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).map(function (x) { return { n: x[0], v: Math.round(x[1]) }; });
      gpTotal = frac.envases + frac.organica + frac.papel;
      if (gpItems.length) graficas.push({ key: 'grandes_productores', titulo: 'Grandes productores (kg, top 8)', spec: { tipo: 'barH', labels: gpItems.map(function (i) { return i.n; }), datasets: [{ label: 'Kg', data: gpItems.map(function (i) { return i.v; }), color: '#0ea5e9' }] } });
      if (gpTotal > 0) graficas.push({ key: 'reparto_fraccion', titulo: 'Reparto por fracción (grandes productores)', spec: { tipo: 'bar', labels: ['Orgánica', 'Envases mezclados', 'Papel/Cartón'], datasets: [{ label: 'Kg', data: [Math.round(frac.organica), Math.round(frac.envases), Math.round(frac.papel)], color: '#16a34a' }] } });
    }
    var an = infResAnual(); if (an.years.length > 1) graficas.push({ key: 'kg_anual', titulo: 'Kg recogidos por año', spec: { tipo: 'bar', labels: an.years, datasets: [{ label: 'Kg', data: an.vals, color: '#16a34a' }] } });
    var kpis = [{ label: 'Kg recogidos (camión)', valor: cur.kg, unidad: 'kg', comp: comp[0] }, { label: 'Salidas del camión', valor: cur.salidas, comp: comp[1] }];
    if (gpTotal > 0) { kpis.push({ label: 'Recogida grandes productores', valor: Math.round(gpTotal), unidad: 'kg' }); kpis.push({ label: 'Orgánica (grandes prod.)', valor: gpTotal ? Math.round(1000 * frac.organica / gpTotal) / 10 : 0, unidad: '%' }); }
    return { kpis: kpis, comparativa: comp, graficas: graficas };
  }
  function infCamMes(anio, mes) { var es = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {}; var e = 0, s = 0, f = false; Object.keys(es).forEach(function (k) { var ok = mes ? (k === anio + '-' + String(mes).padStart(2, '0')) : (k.slice(0, 4) === String(anio)); if (ok) { e += es[k].Avance || 0; s += es[k].Retroceso || 0; f = true; } }); return f ? { entradas: e, salidas: s } : null; }
  function infCamAforo(anio, mes) { var m = (camarasData && camarasData.multiobjeto) || []; var per = 0, vm = 0, vs = 0, f = false; m.forEach(function (r) { var fe = r.fecha || ''; var ok = mes ? (fe.indexOf(anio + '-' + String(mes).padStart(2, '0')) === 0) : (fe.slice(0, 4) === String(anio)); if (ok) { per += (r.personas_avanzar || 0) + (r.personas_retroceso || 0); vm += (r.vehiculos_motor_avanzar || 0) + (r.vehiculos_motor_retroceso || 0); vs += (r.vehiculos_sin_motor_avanzar || 0) + (r.vehiculos_sin_motor_retroceso || 0); f = true; } }); return f ? { personas: per, vehMotor: vm, vehSinMotor: vs } : null; }
  function infBuildCamaras(anio, mes) {
    var cur = infCamMes(anio, mes) || { entradas: null, salidas: null }, prev = String(+anio - 1), ma = null;
    if (mes) { var pm = (+mes) - 1; ma = pm >= 1 ? infCamMes(anio, pm) : infCamMes(prev, 12); }
    var aa = infCamMes(prev, mes);
    var es = (camarasData.lpr && camarasData.lpr.entradasSalidasPorMes) || {};
    var mo = Object.keys(es).filter(function (k) { return k.slice(0, 4) === String(anio); }).sort();
    var comp = [
      { label: 'Entradas', actual: cur.entradas, mesAnterior: ma ? ma.entradas : null, anioAnterior: aa ? aa.entradas : null, varMes: infPct(cur.entradas, ma && ma.entradas), varAnio: infPct(cur.entradas, aa && aa.entradas) },
      { label: 'Salidas', actual: cur.salidas, mesAnterior: ma ? ma.salidas : null, anioAnterior: aa ? aa.salidas : null, varMes: infPct(cur.salidas, ma && ma.salidas), varAnio: infPct(cur.salidas, aa && aa.salidas) }
    ];
    var graficas = [];
    if (mo.length) {
      graficas.push({ key: 'entradas_salidas_mes', titulo: 'Entradas y salidas por mes (' + anio + ')', spec: { tipo: 'line', labels: mo.map(function (k) { return infMesNombre(parseInt(k.slice(5), 10)); }), datasets: [{ label: 'Entradas', data: mo.map(function (k) { return es[k].Avance || 0; }), color: '#2563eb' }, { label: 'Salidas', data: mo.map(function (k) { return es[k].Retroceso || 0; }), color: '#f59e0b' }] } });
      graficas.push({ key: 'saldo_mes', titulo: 'Saldo (entradas − salidas) por mes (' + anio + ')', spec: { tipo: 'bar', labels: mo.map(function (k) { return infMesNombre(parseInt(k.slice(5), 10)); }), datasets: [{ label: 'Saldo', data: mo.map(function (k) { return (es[k].Avance || 0) - (es[k].Retroceso || 0); }), color: '#16a34a' }] } });
    }
    graficas.push({ key: 'comparativa', titulo: 'Comparativa: actual vs mes y año anterior', spec: infCompSpec(comp) });
    var af = infCamAforo(anio, mes);
    if (af && (af.personas || af.vehMotor || af.vehSinMotor)) graficas.push({ key: 'aforo', titulo: 'Aforo (paso total de personas y vehículos)', spec: { tipo: 'bar', labels: ['Personas', 'Veh. a motor', 'Veh. sin motor'], datasets: [{ label: 'Pasos', data: [af.personas, af.vehMotor, af.vehSinMotor], color: '#7c3aed' }] } });
    var yby = {}; Object.keys(es).forEach(function (k) { var y = k.slice(0, 4); yby[y] = (yby[y] || 0) + (es[k].Avance || 0); }); var ys = Object.keys(yby).sort();
    if (ys.length > 1) graficas.push({ key: 'entradas_anual', titulo: 'Entradas por año', spec: { tipo: 'bar', labels: ys, datasets: [{ label: 'Entradas', data: ys.map(function (y) { return yby[y]; }), color: '#0ea5e9' }] } });
    var kpis = [{ label: 'Entradas de vehículos', valor: cur.entradas, comp: comp[0] }, { label: 'Salidas de vehículos', valor: cur.salidas, comp: comp[1] }, { label: 'Saldo (entradas − salidas)', valor: (cur.entradas != null && cur.salidas != null) ? cur.entradas - cur.salidas : null }];
    if (af) { kpis.push({ label: 'Personas (aforo)', valor: af.personas }); kpis.push({ label: 'Veh. a motor (aforo)', valor: af.vehMotor }); }
    // --- Integración SIT: franjas horarias de peatones + procedencia por cámara (meses con datos horarios) ---
    var sitMes = (typeof _sitData !== 'undefined' && _sitData && _sitData.datos) ? _sitData.datos[anio + '-' + String(mes).padStart(2, '0')] : null;
    if (mes && sitMes) {
      var franjasSet = {}, franjasOrden = [];
      (sitMes.puntos || []).forEach(function (pt) { if (pt.tipo === 'aforo' && pt.franjas) pt.franjas.forEach(function (f) { if (!(f.etq in franjasSet)) franjasOrden.push(f.etq); franjasSet[f.etq] = (franjasSet[f.etq] || 0) + f.entrada + f.salida; }); });
      if (franjasOrden.length) graficas.push({ key: 'peatones_franja', titulo: 'Peatones por franja horaria (aforo, ' + sitMes.periodoLabel + ')', spec: { tipo: 'bar', labels: franjasOrden.map(function (e) { return e.replace(' h', '').replace(':00', 'h'); }), datasets: [{ label: 'Peatones (paso total)', data: franjasOrden.map(function (k) { return franjasSet[k]; }), color: '#0ea5e9' }] } });
      var lprPts = (sitMes.puntos || []).filter(function (pt) { return pt.tipo === 'lpr' && pt.proc; });
      if (lprPts.length) {
        graficas.push({ key: 'procedencia_camara', titulo: 'Procedencia por cámara de tráfico (matrículas)', spec: { tipo: 'bar', labels: lprPts.map(function (pt) { return pt.titulo.replace('Cámara ', '').replace('Rotonda ', ''); }), datasets: [{ label: 'Nacional', data: lprPts.map(function (pt) { return pt.proc.nacional; }), color: '#16a34a' }, { label: 'Extranjero', data: lprPts.map(function (pt) { return pt.proc.extranjero; }), color: '#2563eb' }] } });
        var totNac = lprPts.reduce(function (a, pt) { return a + pt.proc.nacional; }, 0), totExt = lprPts.reduce(function (a, pt) { return a + pt.proc.extranjero; }, 0);
        if (totNac + totExt) kpis.push({ label: 'Matrícula extranjera', valor: Math.round(1000 * totExt / (totNac + totExt)) / 10, unidad: '%' });
      }
      if (sitMes.kpis && sitMes.kpis.peatones) kpis.push({ label: 'Peatones (aforo por franjas)', valor: sitMes.kpis.peatones });
      // Estudio por horas (perfil 24h) — peatones por cámara de aforo + vehículos LPR
      var labels24 = []; for (var _h = 0; _h < 24; _h++) labels24.push((_h < 10 ? '0' + _h : _h) + 'h');
      (sitMes.puntos || []).forEach(function (pt) {
        if (pt.tipo === 'aforo' && pt.porHora) graficas.push({ key: 'ph_' + pt.n, titulo: 'Peatones por hora — ' + pt.titulo.replace('Cámara ', '') + ' (' + sitMes.periodoLabel + ')', spec: { tipo: 'line', labels: labels24, datasets: [{ label: 'Entrada/subida', data: pt.porHora.map(function (x) { return x.entrada; }), color: '#0ea5e9' }, { label: 'Salida/bajada', data: pt.porHora.map(function (x) { return x.salida; }), color: '#f59e0b' }] } });
      });
      var lprHora = {};
      (sitMes.puntos || []).forEach(function (pt) { if (pt.tipo === 'lpr' && pt.porHora) pt.porHora.forEach(function (x) { lprHora[x.h] = (lprHora[x.h] || 0) + x.total; }); });
      if (Object.keys(lprHora).length) graficas.push({ key: 'veh_hora', titulo: 'Vehículos por hora (tráfico LPR, ' + sitMes.periodoLabel + ')', spec: { tipo: 'line', labels: labels24, datasets: [{ label: 'Vehículos', data: labels24.map(function (_l, i) { return lprHora[i] || 0; }), color: '#2563eb' }] } });
    }
    return { kpis: kpis, comparativa: comp, graficas: graficas };
  }
  function infCamAforoRango(desde, hasta) {
    var m = (camarasData && camarasData.multiobjeto) || [];
    var per = 0, vm = 0, vs = 0, porDia = {}, hay = false;
    m.forEach(function (r) {
      var fd = (r.fecha || '') + '-' + String(r.dia || 1).padStart(2, '0');
      if (fd >= desde && fd <= hasta) {
        var p = (r.personas_avanzar || 0) + (r.personas_retroceso || 0);
        var a = (r.vehiculos_motor_avanzar || 0) + (r.vehiculos_motor_retroceso || 0);
        var s = (r.vehiculos_sin_motor_avanzar || 0) + (r.vehiculos_sin_motor_retroceso || 0);
        per += p; vm += a; vs += s;
        if (!porDia[fd]) porDia[fd] = { p: 0, vm: 0, vs: 0 };
        porDia[fd].p += p; porDia[fd].vm += a; porDia[fd].vs += s; hay = true;
      }
    });
    return hay ? { personas: per, vehMotor: vm, vehSinMotor: vs, porDia: porDia } : null;
  }
  function infLprRango(desde, hasta) {
    var esd = (camarasData && camarasData.lpr && camarasData.lpr.entradasSalidasPorDia) || {};
    var e = 0, s = 0, porDia = {}, hay = false;
    Object.keys(esd).forEach(function (k) {
      if (k >= desde && k <= hasta) { e += esd[k].Avance || 0; s += esd[k].Retroceso || 0; porDia[k] = { e: esd[k].Avance || 0, s: esd[k].Retroceso || 0 }; hay = true; }
    });
    return hay ? { entradas: e, salidas: s, porDia: porDia } : null;
  }
  function infCompSpecRango(comp) { return { tipo: 'bar', labels: comp.map(function (c) { return c.label; }), datasets: [{ label: 'Actual', data: comp.map(function (c) { return c.actual; }), color: '#2563eb' }, { label: 'Periodo anterior', data: comp.map(function (c) { return c.mesAnterior; }), color: '#93c5fd' }, { label: 'Año anterior', data: comp.map(function (c) { return c.anioAnterior; }), color: '#f59e0b' }] }; }
  function infBuildCamarasRango(desde, hasta) {
    var dur = infDiasEntre(desde, hasta);
    var pD = infShiftISO(desde, -dur), pH = infShiftISO(desde, -1);
    var yD = infShiftAnioISO(desde, -1), yH = infShiftAnioISO(hasta, -1);
    var af = infCamAforoRango(desde, hasta), afP = infCamAforoRango(pD, pH), afY = infCamAforoRango(yD, yH);
    var lp = infLprRango(desde, hasta), lpP = infLprRango(pD, pH), lpY = infLprRango(yD, yH);
    var graficas = [], kpis = [], comp = [];
    var mk = function (label, a, pa, aa) { return { label: label, actual: a, mesAnterior: (pa == null ? null : pa), anioAnterior: (aa == null ? null : aa), varMes: infPct(a, pa), varAnio: infPct(a, aa), labelMes: 'vs periodo ant.' }; };
    if (lp) { comp.push(mk('Entradas', lp.entradas, lpP && lpP.entradas, lpY && lpY.entradas)); comp.push(mk('Salidas', lp.salidas, lpP && lpP.salidas, lpY && lpY.salidas)); }
    if (af) { comp.push(mk('Personas (aforo)', af.personas, afP && afP.personas, afY && afY.personas)); comp.push(mk('Veh. a motor (aforo)', af.vehMotor, afP && afP.vehMotor, afY && afY.vehMotor)); }
    if (lp) {
      var dl = Object.keys(lp.porDia).sort();
      graficas.push({ key: 'es_dia', titulo: 'Entradas y salidas por día (LPR)', spec: { tipo: 'line', labels: dl.map(infDiaCorto), datasets: [{ label: 'Entradas', data: dl.map(function (d) { return lp.porDia[d].e; }), color: '#2563eb' }, { label: 'Salidas', data: dl.map(function (d) { return lp.porDia[d].s; }), color: '#f59e0b' }] } });
      graficas.push({ key: 'saldo_dia', titulo: 'Saldo diario (entradas − salidas)', spec: { tipo: 'bar', labels: dl.map(infDiaCorto), datasets: [{ label: 'Saldo', data: dl.map(function (d) { return lp.porDia[d].e - lp.porDia[d].s; }), color: '#16a34a' }] } });
    }
    if (af) {
      var da = Object.keys(af.porDia).sort();
      graficas.push({ key: 'aforo_personas_dia', titulo: 'Personas por día (aforo)', spec: { tipo: 'line', labels: da.map(infDiaCorto), datasets: [{ label: 'Personas', data: da.map(function (d) { return af.porDia[d].p; }), color: '#7c3aed' }] } });
      graficas.push({ key: 'aforo_veh_dia', titulo: 'Vehículos por día (aforo)', spec: { tipo: 'line', labels: da.map(infDiaCorto), datasets: [{ label: 'A motor', data: da.map(function (d) { return af.porDia[d].vm; }), color: '#0891b2' }, { label: 'Sin motor', data: da.map(function (d) { return af.porDia[d].vs; }), color: '#f59e0b' }] } });
      graficas.push({ key: 'aforo_reparto', titulo: 'Aforo: reparto por tipo', spec: { tipo: 'bar', labels: ['Personas', 'Veh. a motor', 'Veh. sin motor'], datasets: [{ label: 'Pasos', data: [af.personas, af.vehMotor, af.vehSinMotor], color: '#7c3aed' }] } });
    }
    if (comp.length) graficas.push({ key: 'comparativa', titulo: 'Comparativa: periodo vs anterior y año anterior', spec: infCompSpecRango(comp) });
    if (lp) { kpis.push({ label: 'Entradas de vehículos', valor: lp.entradas, comp: comp[0] }); kpis.push({ label: 'Salidas de vehículos', valor: lp.salidas, comp: comp[1] }); kpis.push({ label: 'Saldo (entradas − salidas)', valor: lp.entradas - lp.salidas }); }
    if (af) { kpis.push({ label: 'Personas (aforo)', valor: af.personas, comp: comp[lp ? 2 : 0] }); kpis.push({ label: 'Veh. a motor (aforo)', valor: af.vehMotor, comp: comp[lp ? 3 : 1] }); kpis.push({ label: 'Veh. sin motor (aforo)', valor: af.vehSinMotor }); }
    kpis.push({ label: 'Días del periodo', valor: dur });
    return { kpis: kpis, comparativa: comp, graficas: graficas };
  }
  function infBuild(ambito, anio, mes, rango) {
    if (ambito === 'camaras' && rango && rango.desde && rango.hasta) {
      var br = infBuildCamarasRango(rango.desde, rango.hasta);
      br.periodoLabel = infRangoLabel(rango.desde, rango.hasta); br.rango = rango; br.anio = null; br.mes = null;
      return br;
    }
    var b = ambito === 'turismo' ? infBuildTurismo(anio, mes) : ambito === 'residuos' ? infBuildResiduos(anio, mes) : infBuildCamaras(anio, mes);
    b.periodoLabel = infPeriodoLabel(anio, mes); b.anio = anio; b.mes = mes || null;
    return b;
  }
  function infInsights(data) {
    var ins = {};
    var g = data.graficas.find(function (x) { return x.spec.tipo === 'line' && x.spec.datasets.length && x.spec.labels.length > 2; });
    if (g) {
      var lab = g.spec.labels, d = g.spec.datasets[0].data, mi = -1, ma = -1;
      for (var i = 0; i < d.length; i++) { if (d[i] != null) { if (ma < 0 || d[i] > d[ma]) ma = i; if (mi < 0 || d[i] < d[mi]) mi = i; } }
      if (ma >= 0) { ins.serie = g.titulo; ins.mesPico = { mes: lab[ma], valor: Math.round(d[ma]) }; ins.mesValle = { mes: lab[mi], valor: Math.round(d[mi]) }; }
    }
    if (data.comparativa) { var best = null; data.comparativa.forEach(function (c) { if (c.varAnio != null && (best == null || Math.abs(c.varAnio) > Math.abs(best.pct))) best = { metrica: c.label, pct: Math.round(c.varAnio * 10) / 10 }; }); if (best) ins.mayorVariacionInteranual = best; }
    return ins;
  }
  function infMakeChart(canvasId, spec) {
    var c = document.getElementById(canvasId); if (!c || !spec) return null;
    var type = spec.tipo === 'line' ? 'line' : 'bar', multi = spec.datasets.length > 1;
    var ds = spec.datasets.map(function (d) { if (type === 'line') return { label: d.label, data: d.data, borderColor: d.color || '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', tension: 0.3, pointRadius: 3, fill: !multi }; return { label: d.label, data: d.data, backgroundColor: d.color || '#2563eb', borderRadius: 4 }; });
    var opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: multi, position: 'bottom' }, tooltip: { callbacks: { label: function (x) { return (x.dataset.label ? x.dataset.label + ': ' : '') + tFmtNum(x.raw); } } } } };
    if (spec.tipo === 'barH') { opts.indexAxis = 'y'; opts.scales = { x: { ticks: { callback: function (v) { return tFmtNum(v); } } } }; }
    else { opts.scales = { y: { beginAtZero: true, ticks: { callback: function (v) { return tFmtNum(v); } } } }; }
    return new Chart(c, { type: type, data: { labels: spec.labels, datasets: ds }, options: opts });
  }
  var INF_FUENTES = {
    turismo: 'INE (EOH/EOAP/EOAC y movilidad turística) y SIT-CV (Invat·tur).',
    residuos: 'Recogida del camión (Sigeus), báscula municipal y FOBESA (grandes productores).',
    camaras: 'Cámaras LPR de tráfico y cámaras de aforo multiobjeto del municipio.'
  };
  function infKpiVar(k) {
    if (!k.comp) return '';
    var v = k.comp.varAnio != null ? k.comp.varAnio : k.comp.varMes;
    var lbl = k.comp.varAnio != null ? 'interanual' : (k.comp.labelMes || 'vs mes ant.');
    if (v == null) return '';
    var up = v >= 0;
    return '<span class="informe-kpi-var ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + String(Math.round(v * 10) / 10).replace('.', ',') + '% ' + lbl + '</span>';
  }
  function infRenderInforme(amb, data, texto) {
    var ids = infIds(amb), st = infSt(amb), salida = document.getElementById(ids.salida);
    Object.keys(st.charts).forEach(function (k) { if (st.charts[k]) st.charts[k].destroy(); }); st.charts = {};
    var gmap = {}; data.graficas.forEach(function (g) { gmap[g.key] = g; });
    var used = {};
    var chartId = function (key) { return 'inf-' + amb + '-chart-' + key; };
    var grafHtml = function (g) { return '<div class="informe-grafica turismo-chart-card"><h4>' + infEsc(g.titulo) + '</h4><div class="chart-container" style="height:240px"><canvas id="' + chartId(g.key) + '"></canvas></div></div>'; };
    var inline = function (t) { return infEsc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>'); };
    var lines = String(texto || '').split(/\r?\n/), nodes = [], headingIdx = [], inList = false, secNum = 0;
    var closeList = function () { if (inList) { nodes.push('</ul>'); inList = false; } };
    lines.forEach(function (ln) {
      var t = ln.trim();
      var mg = t.match(/^\[?\s*GRAFICA:\s*([a-z0-9_]+)\s*\]?$/i);
      if (mg) { closeList(); var key = mg[1]; if (gmap[key] && !used[key]) { used[key] = true; nodes.push(grafHtml(gmap[key])); } return; }
      if (!t) { closeList(); return; }
      if (/^###\s+/.test(t)) { closeList(); nodes.push('<h4 class="informe-h">' + inline(t.replace(/^###\s+/, '')) + '</h4>'); }
      else if (/^##\s+/.test(t)) { closeList(); secNum++; headingIdx.push(nodes.length); nodes.push('<h3 class="informe-h"><span class="informe-h-num">' + secNum + '</span>' + inline(t.replace(/^##\s+/, '')) + '</h3>'); }
      else if (/^#\s+/.test(t)) { closeList(); nodes.push('<h2 class="informe-h1">' + inline(t.replace(/^#\s+/, '')) + '</h2>'); }
      else if (/^[-*]\s+/.test(t)) { if (!inList) { nodes.push('<ul>'); inList = true; } nodes.push('<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>'); }
      else { closeList(); nodes.push('<p>' + inline(t) + '</p>'); }
    });
    closeList();
    var restantes = data.graficas.filter(function (g) { return !used[g.key]; });
    var targets = headingIdx.slice(1);
    for (var ti = targets.length - 1; ti >= 0 && restantes.length; ti--) { var g = restantes.pop(); used[g.key] = true; nodes.splice(targets[ti], 0, grafHtml(g)); }
    restantes.forEach(function (g) { used[g.key] = true; nodes.push(grafHtml(g)); });
    var body = nodes.join('');
    // Numera las gráficas en orden de aparición: "Gráfico N. Título"
    var gnum = 0;
    body = body.replace(/<div class="informe-grafica turismo-chart-card"><h4>/g, function () { gnum++; return '<div class="informe-grafica turismo-chart-card"><h4>Gráfico ' + gnum + '. '; });
    var kpisHtml = data.kpis.filter(function (k) { return k.valor != null; }).map(function (k) { return '<div class="informe-kpi"><div class="informe-kpi-label">' + infEsc(k.label) + '</div><div class="informe-kpi-value">' + infFmt(k.valor) + (k.unidad === '%' ? ' %' : k.unidad === '€' ? ' €' : k.unidad === 'noches' ? ' noches' : '') + '</div>' + infKpiVar(k) + '</div>'; }).join('');
    var hoy = new Date().toLocaleDateString('es-ES');
    var coverHtml = '<div class="informe-portada"><img src="assets/peniscola-portada.jpg" class="informe-portada-img" alt="Peñíscola"><div class="informe-portada-txt"><img src="assets/logo-ajuntament.png" class="informe-portada-logo" alt=""><div class="informe-portada-eyebrow">Ayuntamiento de Peñíscola</div><div class="informe-portada-tipo">' + infEsc(infAmbitoTitulo(amb)) + '</div><div class="informe-portada-periodo">' + infEsc(data.periodoLabel) + '</div><div class="informe-portada-fecha">Emitido el ' + hoy + '</div></div></div>';
    var flowHtml = '<div class="informe-kpis">' + kpisHtml + '</div>' + '<div class="informe-texto">' + body + '</div>';
    var footerHtml = '<div class="informe-footer">Informe generado automáticamente a partir de los datos del dashboard municipal. Fuentes: ' + (INF_FUENTES[amb] || '—') + ' · Emitido el ' + hoy + '.</div>';
    salida.innerHTML = '<div class="turismo-section-card informe-doc">' +
      '<div class="informe-toolbar"><button type="button" class="reload-btn" id="inf-' + amb + '-print" style="background:#e2e8f0;color:#334155">🖨️ Imprimir</button><button type="button" class="reload-btn" id="inf-' + amb + '-pdf" style="background:#dc2626;color:#fff">⬇️ Descargar PDF</button><button type="button" class="reload-btn" id="inf-' + amb + '-word" style="background:#2563eb;color:#fff">⬇️ Descargar Word</button></div>' +
      '<div class="informe-pages" id="inf-pages-' + amb + '"></div>' +
      '</div>';
    // Reparte el contenido en páginas A4 (portada = página 1)
    var tmp = document.createElement('div');
    tmp.className = 'informe-texto'; // para que la maqueta mida igual que dentro de la página
    tmp.innerHTML = flowHtml;
    var blocks = [];
    // aplanamos: el .informe-texto interior lo desglosamos en sus bloques
    Array.prototype.slice.call(tmp.children).forEach(function (child) {
      if (child.classList && child.classList.contains('informe-texto')) {
        while (child.firstElementChild) { blocks.push(child.firstElementChild); child.removeChild(child.firstElementChild); }
      } else { blocks.push(child); }
    });
    infPaginate(amb, coverHtml, blocks, footerHtml);
    var pbtn = document.getElementById('inf-' + amb + '-print'); if (pbtn) pbtn.onclick = function () { window.print(); };
    var wbtn = document.getElementById('inf-' + amb + '-word'); if (wbtn) wbtn.onclick = function () { infDownloadWord(amb); };
    var pdfb = document.getElementById('inf-' + amb + '-pdf'); if (pdfb) pdfb.onclick = function () { infDownloadPdf(amb, pdfb); };
    data.graficas.forEach(function (g) { if (used[g.key]) st.charts[g.key] = infMakeChart(chartId(g.key), g.spec); });
    infAppendSitPro(amb, data);
  }
  // Combina el informe profesional SIT (HTML estático por punto de control) dentro del informe de Cámaras
  function infAppendSitPro(amb, data) {
    if (amb !== 'camaras') return;
    var doc = document.querySelector('#inf-' + amb + '-salida .informe-doc'); if (!doc) return;
    var prev = doc.querySelector('.inf-sitpro'); if (prev) prev.remove();
    fetch('data/informes_sit/manifest.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      var items = (m && m.informes) || [];
      var it = null;
      for (var i = 0; i < items.length; i++) { if (items[i].label === data.periodoLabel) { it = items[i]; break; } }
      if (!it) return;
      var url = 'data/informes_sit/' + it.archivo + '?t=' + Date.now();
      var sec = document.createElement('div'); sec.className = 'inf-sitpro';
      sec.innerHTML =
        '<div class="inf-sitpro-head">' +
        '<div><div class="inf-sitpro-eyebrow">Continúa el informe</div>' +
        '<h3 class="inf-sitpro-title">Informe profesional por punto de control (SIT)</h3>' +
        '<p class="inf-sitpro-desc">Ficha detallada de cada una de las 9 cámaras según la especificación del Ayuntamiento: series diarias, franjas horarias, franja punta, procedencia y laborable/fin de semana.</p></div>' +
        '<div class="inf-sitpro-actions"><button type="button" class="reload-btn inf-sitpro-open" style="background:#1d4ed8;color:#fff">Abrir a pantalla completa</button>' +
        '<a class="reload-btn inf-sitpro-dl" style="background:#334155;color:#fff;text-decoration:none" download="' + it.archivo + '">Descargar</a></div></div>' +
        '<iframe class="inf-sitpro-frame" title="Informe profesional SIT" loading="lazy"></iframe>';
      doc.appendChild(sec);
      var frame = sec.querySelector('.inf-sitpro-frame');
      var openBtn = sec.querySelector('.inf-sitpro-open'), dl = sec.querySelector('.inf-sitpro-dl');
      if (openBtn) openBtn.onclick = function () { window.open(url, '_blank'); };
      if (dl) dl.href = url;
      var ajusta = function () { try { var h = frame.contentDocument.body.scrollHeight; if (h) frame.style.height = (h + 30) + 'px'; } catch (e) { } };
      frame.onload = function () { ajusta(); setTimeout(ajusta, 500); setTimeout(ajusta, 1500); };
      frame.src = url;
    }).catch(function () { });
  }
  function infDownloadPdf(amb, btn) {
    if (typeof window.html2canvas !== 'function' || !window.jspdf || !window.jspdf.jsPDF) { alert('No se pudieron cargar las librerías de PDF (revisa la conexión).'); return; }
    var pages = document.querySelectorAll('#inf-pages-' + amb + ' .informe-page');
    if (!pages.length) return;
    var orig = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Generando PDF…'; }
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    var W = 210, H = 297;
    var i = 0;
    var next = function () {
      if (i >= pages.length) {
        pdf.save('Informe_' + infAmbitoTitulo(amb).replace(/[^a-zA-Z0-9]+/g, '_') + '.pdf');
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        return;
      }
      window.html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false }).then(function (canvas) {
        var img = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, W, H, undefined, 'FAST');
        i++;
        setTimeout(next, 10);
      }).catch(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = orig; }
        alert('Error al generar el PDF: ' + (e.message || e));
      });
    };
    next();
  }
  function infPaginate(amb, coverHtml, blocks, footerHtml) {
    var wrap = document.getElementById('inf-pages-' + amb); if (!wrap) return;
    wrap.innerHTML = '';
    var cover = document.createElement('div'); cover.className = 'informe-page informe-page-cover'; cover.innerHTML = coverHtml; wrap.appendChild(cover);
    var MAXH = 1128;
    var mk = function () { var p = document.createElement('div'); p.className = 'informe-page'; var inner = document.createElement('div'); inner.className = 'informe-texto informe-page-body'; p.appendChild(inner); wrap.appendChild(p); return inner; };
    var esTitulo = function (n) { return n && n.classList && (n.classList.contains('informe-h') || n.classList.contains('informe-h1')); };
    var cur = mk();
    blocks.forEach(function (el) {
      cur.appendChild(el);
      if (cur.parentNode.scrollHeight > MAXH && cur.children.length > 1) {
        cur.removeChild(el);
        // Si justo antes hay un título (o título + 1 párrafo corto), bájalo con el bloque
        // para que el encabezado no quede huérfano al pie de la página.
        var prev = cur.lastElementChild;
        var arrastra = [];
        if (esTitulo(prev) && cur.children.length > 1) { arrastra.unshift(prev); cur.removeChild(prev); }
        else if (prev && prev.tagName === 'P' && esTitulo(prev.previousElementSibling) && cur.children.length > 2) { arrastra.unshift(prev); cur.removeChild(prev); var h = cur.lastElementChild; arrastra.unshift(h); cur.removeChild(h); }
        cur = mk();
        arrastra.forEach(function (n) { cur.appendChild(n); });
        cur.appendChild(el);
      }
    });
    var f = document.createElement('div'); f.innerHTML = footerHtml; var fel = f.firstElementChild;
    if (fel) { cur.appendChild(fel); if (cur.parentNode.scrollHeight > MAXH && cur.children.length > 1) { cur.removeChild(fel); cur = mk(); cur.appendChild(fel); } }
    var pgs = wrap.children;
    for (var i = 0; i < pgs.length; i++) { var n = document.createElement('div'); n.className = 'informe-page-num'; n.textContent = (i + 1) + ' / ' + pgs.length; pgs[i].appendChild(n); }
  }
  function infDownloadWord(amb) {
    var salida = document.getElementById(infIds(amb).salida);
    var doc = salida && salida.querySelector('.informe-doc'); if (!doc) return;
    var clone = doc.cloneNode(true);
    var tb = clone.querySelector('.informe-toolbar'); if (tb) tb.parentNode.removeChild(tb);
    var srcC = doc.querySelectorAll('canvas'), dstC = clone.querySelectorAll('canvas');
    dstC.forEach(function (c, i) { try { var img = document.createElement('img'); img.src = srcC[i].toDataURL('image/png'); img.setAttribute('width', '560'); c.parentNode.replaceChild(img, c); } catch (e) {} });
    // Incrusta también fotos/logos (portada + logo) como data URL para que salgan en el Word
    clone.querySelectorAll('img').forEach(function (im) {
      if (im.getAttribute('src') && im.getAttribute('src').indexOf('data:') === 0) return;
      var path = im.getAttribute('src');
      var s = doc.querySelector('img[src="' + path + '"]');
      if (s && s.complete && s.naturalWidth) { try { var cv = document.createElement('canvas'); cv.width = s.naturalWidth; cv.height = s.naturalHeight; cv.getContext('2d').drawImage(s, 0, 0); im.setAttribute('src', cv.toDataURL('image/jpeg', 0.85)); if (im.className.indexOf('portada-img') >= 0) im.setAttribute('width', '620'); } catch (e) {} }
    });
    // Aplana las páginas A4: en el Word no queremos las cajas; solo el contenido en flujo, con salto tras la portada.
    var pages = clone.querySelectorAll('.informe-page');
    if (pages.length) {
      var flat = document.createElement('div');
      Array.prototype.forEach.call(pages, function (pg) {
        var num = pg.querySelector('.informe-page-num'); if (num) num.parentNode.removeChild(num);
        var cover = pg.querySelector('.informe-portada');
        var pageBody = pg.querySelector('.informe-page-body');
        if (cover) {
          var photo = cover.querySelector('.informe-portada-img');
          var tipo = cover.querySelector('.informe-portada-tipo');
          var per = cover.querySelector('.informe-portada-periodo');
          var cw = document.createElement('div'); cw.setAttribute('align', 'center');
          if (photo) cw.appendChild(photo.cloneNode(true));
          var h = document.createElement('div'); h.setAttribute('align', 'center');
          h.innerHTML = '<div style="font-size:26pt;font-weight:bold;color:#0f172a;margin-top:12pt">' + (tipo ? tipo.textContent : '') + '</div><div style="font-size:16pt;color:#334155">' + (per ? per.textContent : '') + '</div>';
          cw.appendChild(h);
          flat.appendChild(cw);
          var brk = document.createElement('br'); brk.style.pageBreakAfter = 'always'; flat.appendChild(brk);
        } else if (pageBody) { while (pageBody.firstChild) flat.appendChild(pageBody.firstChild); }
      });
      var pagesWrap = clone.querySelector('.informe-pages'); if (pagesWrap) pagesWrap.parentNode.replaceChild(flat, pagesWrap);
    }
    var css = [
      'body{font-family:Calibri,"Segoe UI",Arial,sans-serif;color:#334155;font-size:11pt;line-height:1.5}',
      'p{text-align:justify;margin:6pt 0}',
      '.informe-kpis{margin:8pt 0 12pt}',
      '.informe-kpi{display:inline-block;vertical-align:top;width:150pt;border:1px solid #e6eaf1;border-top:3px solid #2563eb;padding:7pt 9pt;margin:0 6pt 6pt 0}',
      '.informe-kpi-label{font-size:8pt;text-transform:uppercase;color:#64748b;font-weight:bold;display:block}',
      '.informe-kpi-value{font-size:15pt;font-weight:bold;color:#0f172a;display:block;margin-top:2pt}',
      '.informe-kpi-var{font-size:8pt;font-weight:bold}',
      '.up{color:#166534}.down{color:#991b1b}',
      '.informe-h1{font-size:16pt;color:#0f172a;font-weight:bold;margin:14pt 0 6pt}',
      '.informe-h{font-size:14pt;color:#0f172a;font-weight:bold;margin:16pt 0 8pt;border-bottom:2px solid #e2e8f0;padding-bottom:4pt}',
      '.informe-h-num{background:#2563eb;color:#fff;padding:1pt 6pt;margin-right:6pt;font-size:10pt}',
      '.informe-grafica{margin:10pt 0;text-align:center}',
      '.informe-grafica h4{font-size:10pt;color:#475569;font-weight:bold;margin:0 0 4pt}',
      'ul{margin:6pt 0 6pt 16pt}li{margin:3pt 0;text-align:justify}',
      'img{margin:6pt auto;max-width:100%}',
      '.informe-footer{color:#64748b;font-size:8.5pt;border-top:1px solid #e2e8f0;margin-top:14pt;padding-top:8pt}'
    ].join('');
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Informe</title><style>' + css + '</style></head><body>' + clone.innerHTML + '</body></html>';
    var blob = new Blob(['﻿' + html], { type: 'application/msword' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'Informe_' + infAmbitoTitulo(amb).replace(/[^a-zA-Z0-9]+/g, '_') + '.doc';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }
  function infStartProgress(estado) {
    estado.innerHTML = '<div class="inf-progress-wrap"><div class="inf-progress-track"><div class="inf-progress-fill"></div></div><span class="inf-progress-pct">0%</span><span class="inf-progress-lbl">Redactando el informe…</span></div>';
    var fill = estado.querySelector('.inf-progress-fill'), pctEl = estado.querySelector('.inf-progress-pct');
    var pct = 0;
    var timer = setInterval(function () {
      if (pct < 90) { pct += Math.max(0.5, (90 - pct) * 0.05); if (pct > 90) pct = 90; if (fill) fill.style.width = pct + '%'; if (pctEl) pctEl.textContent = Math.round(pct) + '%'; }
    }, 180);
    var set = function (p) { pct = p; if (fill) fill.style.width = p + '%'; if (pctEl) pctEl.textContent = Math.round(p) + '%'; };
    return {
      finish: function (cb) { clearInterval(timer); set(100); setTimeout(function () { if (cb) cb(); }, 450); },
      stop: function () { clearInterval(timer); }
    };
  }
  function generarInforme(amb) {
    var ids = infIds(amb);
    var modoEl = document.getElementById('inf-' + amb + '-modo');
    var esRango = (amb === 'camaras' && modoEl && modoEl.value === 'rango');
    var anio = document.getElementById(ids.anio).value, mes = document.getElementById(ids.mes).value, rango = null;
    var estado = document.getElementById(ids.estado), salida = document.getElementById(ids.salida), btn = document.getElementById(ids.generar);
    if (esRango) {
      var desde = (document.getElementById('inf-' + amb + '-desde') || {}).value || '';
      var hasta = (document.getElementById('inf-' + amb + '-hasta') || {}).value || '';
      if (!desde || !hasta) { estado.textContent = 'Elige las fechas de inicio y fin.'; return; }
      if (desde > hasta) { estado.textContent = 'La fecha "Desde" no puede ser posterior a "Hasta".'; return; }
      rango = { desde: desde, hasta: hasta };
    } else if (!anio) { estado.textContent = 'No hay datos para este periodo.'; return; }
    btn.disabled = true; var orig = btn.textContent; btn.textContent = 'Generando…';
    salida.innerHTML = '';
    var prog = infStartProgress(estado);
    infEnsure(amb).then(function () {
      var data = infBuild(amb, anio, mes, rango); infSt(amb).data = data;
      if (!data.kpis || !data.kpis.length) throw new Error(esRango ? 'No hay datos de cámaras en ese rango de fechas.' : 'No hay datos para este periodo.');
      var datos = { kpis: data.kpis.map(function (k) { return { label: k.label, valor: k.valor, unidad: k.unidad || '', varMes: k.comp && k.comp.varMes != null ? Math.round(k.comp.varMes * 10) / 10 : null, varAnio: k.comp && k.comp.varAnio != null ? Math.round(k.comp.varAnio * 10) / 10 : null }; }), comparativa: data.comparativa, insights: infInsights(data), graficas: data.graficas.map(function (g) { return { clave: g.key, titulo: g.titulo, labels: g.spec.labels, series: g.spec.datasets.map(function (d) { return { nombre: d.label, datos: d.data }; }) }; }) };
      return fetch('/api/informe-ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ambito: amb, periodoLabel: data.periodoLabel, datos: datos }) }).then(function (r) { return r.json(); });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      prog.finish(function () { infRenderInforme(amb, infSt(amb).data, res.texto); estado.innerHTML = ''; });
    }).catch(function (e) { prog.stop(); estado.textContent = 'Error: ' + (e.message || e); })
      .finally(function () { btn.disabled = false; btn.textContent = orig; });
  }
  function infPopulateMeses(amb) {
    var ids = infIds(amb), anio = document.getElementById(ids.anio).value, selM = document.getElementById(ids.mes);
    var meses = infMeses(amb, anio);
    selM.innerHTML = '<option value="">Todo el año</option>' + meses.map(function (m) { return '<option value="' + m + '">' + infMesNombre(m) + '</option>'; }).join('');
  }
  function infPopulate(amb) {
    var ids = infIds(amb), selA = document.getElementById(ids.anio), estado = document.getElementById(ids.estado);
    if (!selA) return Promise.resolve();
    if (estado) estado.textContent = 'Cargando datos…';
    return infEnsure(amb).then(function () {
      var anios = infAnios(amb);
      selA.innerHTML = anios.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
      if (anios.length) selA.value = anios[anios.length - 1];
      infPopulateMeses(amb);
      if (estado) estado.textContent = anios.length ? '' : 'No hay datos para este ámbito todavía.';
    }).catch(function () { if (estado) estado.textContent = 'No se pudieron cargar los datos.'; });
  }
  // ---- Archivo / registro de informes (ficheros pregenerados en data/informes_archivo) ----
  var _infManifest = null;
  function infArchivoUrl(rel) { return (typeof dataUrl === 'function') ? dataUrl(rel) : '/' + rel; }
  function infArchivoManifest() {
    if (_infManifest) return Promise.resolve(_infManifest);
    return fetch(infArchivoUrl('data/informes_archivo/manifest.json'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) { _infManifest = m || {}; return _infManifest; })
      .catch(function () { _infManifest = {}; return _infManifest; });
  }
  var INF_ARCH_ESTILO = {
    camaras: { accent: '#6366f1', ico: '📷' },
    residuos: { accent: '#16a34a', ico: '♻️' },
    turismo: { accent: '#0ea5e9', ico: '✨' }
  };
  function infArchivoRender(amb) {
    var cont = document.getElementById('inf-' + amb + '-archivo'); if (!cont) return;
    var est = INF_ARCH_ESTILO[amb] || { accent: '#6366f1', ico: '📄' };
    infArchivoManifest().then(function (m) {
      var items = (m && m[amb]) || [];
      if (!items.length) { cont.innerHTML = '<span style="color:#94a3b8;font-size:.85rem">Aún no hay informes archivados para este módulo.</span>'; return; }
      var byYear = {};
      items.forEach(function (it) { (byYear[it.anio] = byYear[it.anio] || []).push(it); });
      var years = Object.keys(byYear).sort(function (a, b) { return b - a; });
      cont.innerHTML = years.map(function (y) {
        var cards = byYear[y].slice().sort(function (a, b) { return a.mes - b.mes; }).map(function (it) {
          return '<button type="button" class="inf-arch-card" style="--arch-accent:' + est.accent + '" data-amb="' + amb + '" data-ym="' + it.ym + '">' +
            '<span class="inf-arch-card-ico">' + est.ico + '</span>' +
            '<span class="inf-arch-card-mes">' + (MESES[it.mes - 1] || it.mes) + '</span>' +
            '<span class="inf-arch-card-anio">' + y + '</span></button>';
        }).join('');
        var n = byYear[y].length;
        return '<div class="inf-arch-year"><div class="inf-arch-year-head">📂 ' + y + '<span class="inf-arch-year-badge">' + n + ' informe' + (n > 1 ? 's' : '') + '</span></div><div class="inf-arch-grid">' + cards + '</div></div>';
      }).join('');
      cont.querySelectorAll('.inf-arch-card').forEach(function (b) { b.addEventListener('click', function () { infArchivoAbrir(b.getAttribute('data-amb'), b.getAttribute('data-ym')); }); });
    });
  }
  function infArchivoAbrir(amb, ym) {
    var estado = document.getElementById('inf-' + amb + '-estado'); if (estado) estado.textContent = 'Abriendo informe archivado…';
    fetch(infArchivoUrl('data/informes_archivo/' + amb + '/' + ym + '.json'), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (reg) {
        infSt(amb).data = reg.data;
        infRenderInforme(amb, reg.data, reg.texto);
        if (estado) estado.textContent = '';
        var sal = document.getElementById('inf-' + amb + '-salida'); if (sal) sal.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function () { if (estado) estado.textContent = 'No se pudo abrir el informe archivado.'; });
  }
  function initInformesSection(amb) {
    var st = infSt(amb), ids = infIds(amb);
    if (st.bound) return;
    st.bound = true;
    infArchivoRender(amb);
    var y = document.getElementById(ids.anio); if (y) y.addEventListener('change', function () { infPopulateMeses(amb); });
    var g = document.getElementById(ids.generar); if (g) g.addEventListener('click', function () { generarInforme(amb); });
    var p = document.getElementById(ids.imprimir); if (p) p.addEventListener('click', function () { window.print(); });
    var modo = document.getElementById('inf-' + amb + '-modo');
    if (modo) {
      var wrap = function (k) { return document.getElementById('inf-' + amb + '-' + k + '-wrap'); };
      var toggle = function () {
        var r = modo.value === 'rango';
        ['anio', 'mes'].forEach(function (k) { var e = wrap(k); if (e) e.style.display = r ? 'none' : 'inline-flex'; });
        ['desde', 'hasta'].forEach(function (k) { var e = wrap(k); if (e) e.style.display = r ? 'inline-flex' : 'none'; });
      };
      modo.addEventListener('change', toggle);
      infEnsure(amb).then(function () {
        var m = (camarasData && camarasData.multiobjeto) || [];
        var fechas = m.map(function (r) { return (r.fecha || '') + '-' + String(r.dia || 1).padStart(2, '0'); }).filter(Boolean).sort();
        if (fechas.length) {
          var min = fechas[0], max = fechas[fechas.length - 1];
          ['desde', 'hasta'].forEach(function (k) { var e = document.getElementById('inf-' + amb + '-' + k); if (e) { e.min = min; e.max = max; } });
          var dh = document.getElementById('inf-' + amb + '-hasta'); if (dh && !dh.value) dh.value = max;
          var dd = document.getElementById('inf-' + amb + '-desde'); if (dd && !dd.value) dd.value = infShiftISO(max, -6);
        }
        toggle();
      });
    }
    infPopulate(amb);
  }

  /* ===================== CÁMARAS — PERFIL POR HORAS ===================== */
  var _sitData = null, _phBound = false, _phChart = null;
  function sitFmt(n) { return (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('es-ES'); }
  function sitEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function sitLoad() {
    if (_sitData) return Promise.resolve(_sitData);
    var url = (typeof dataUrl === 'function') ? dataUrl('data/camaras/sit_camaras.json') : '/data/camaras/sit_camaras.json';
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { _sitData = d; return d; }).catch(function () { return null; });
  }
  function sitKpi(valor, label, sub, color) {
    return '<div class="sit-kpi"><div class="sit-kpi-val" style="color:' + color + '">' + valor + '</div><div class="sit-kpi-lbl">' + label + '</div>' + (sub ? '<div class="sit-kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function sitBarProc(p) {
    return '<div class="sit-proc"><div class="sit-proc-bar"><span style="width:' + p.pctNac + '%;background:#16a34a"></span><span style="width:' + p.pctExt + '%;background:#2563eb"></span></div>' +
      '<div class="sit-proc-leg"><span><i style="background:#16a34a"></i> Nacional ' + sitFmt(p.nacional) + ' (' + String(p.pctNac).replace('.', ',') + '%)</span>' +
      '<span><i style="background:#2563eb"></i> Extranjero ' + sitFmt(p.extranjero) + ' (' + String(p.pctExt).replace('.', ',') + '%)</span></div></div>';
  }
  function sitTablaFranjas(fr) {
    var max = Math.max.apply(null, fr.map(function (f) { return f.entrada + f.salida; })) || 1;
    var filas = fr.map(function (f) {
      var t = f.entrada + f.salida, pct = Math.round(100 * t / max);
      return '<tr><td>' + f.etq + '</td><td class="n">' + sitFmt(f.entrada) + '</td><td class="n">' + sitFmt(f.salida) + '</td>' +
        '<td class="n"><div class="sit-fr-bar"><span style="width:' + pct + '%"></span><b>' + sitFmt(t) + '</b></div></td></tr>';
    }).join('');
    return '<table class="sit-tabla"><thead><tr><th>Franja horaria</th><th>Entrada</th><th>Salida</th><th>Total</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }
  function sitPuntoHtml(p) {
    var badge = '<span class="sit-num">' + p.n + '</span>';
    if (p.tipo === 'pendiente') return '<div class="sit-card sit-pend">' + badge + '<h3>' + sitEsc(p.titulo) + '</h3><p class="sit-pend-txt">⏳ Pendiente — ' + sitEsc(p.motivo) + '</p></div>';
    if (p.estado === 'sin_datos') return '<div class="sit-card">' + badge + '<h3>' + sitEsc(p.titulo) + '</h3><p class="sit-pend-txt">Sin datos para este mes.</p></div>';
    if (p.tipo === 'lpr') {
      return '<div class="sit-card">' + badge + '<h3>' + sitEsc(p.titulo) + ' <span class="sit-tag lpr">Tráfico · LPR</span></h3>' +
        '<div class="sit-mini">' +
          sitKpi(sitFmt(p.entradas), 'Sentido ' + sitEsc(p.sentEnt), '', '#2563eb') +
          sitKpi(sitFmt(p.salidas), 'Sentido ' + sitEsc(p.sentSal), '', '#f59e0b') +
          sitKpi((p.balance >= 0 ? '+' : '') + sitFmt(p.balance), 'Balance del periodo', '', p.balance >= 0 ? '#16a34a' : '#ef4444') +
          sitKpi(p.pico, 'Franja horaria pico', '', '#7c3aed') +
        '</div>' +
        '<div class="sit-sub">Procedencia de los vehículos</div>' + sitBarProc(p.proc) + '</div>';
    }
    return '<div class="sit-card">' + badge + '<h3>' + sitEsc(p.titulo) + ' <span class="sit-tag aforo">Aforo · peatones</span></h3>' +
      '<div class="sit-mini">' +
        sitKpi(sitFmt(p.entrada), 'Peatones ' + sitEsc(p.entLbl), '', '#0ea5e9') +
        sitKpi(sitFmt(p.salida), 'Peatones ' + sitEsc(p.salLbl), '', '#f59e0b') +
        sitKpi(p.pico, 'Franja horaria pico', '', '#7c3aed') +
      '</div>' +
      '<div class="sit-sub">Desglose por franjas horarias</div>' + sitTablaFranjas(p.franjas) + '</div>';
  }
  function sitRenderMes(mes) {
    var salida = document.getElementById('sit-salida'); if (!salida || !_sitData) return;
    var d = _sitData.datos[mes]; if (!d) { salida.innerHTML = '<p style="color:#64748b">No hay datos para este mes.</p>'; return; }
    var k = d.kpis;
    var head = '<div class="sit-portada"><div class="sit-portada-tit">Informe de cámaras para el Sistema de Inteligencia Turística · Peñíscola</div>' +
      '<div class="sit-portada-mes">' + sitEsc(d.periodoLabel) + '</div></div>' +
      '<div class="sit-kpis">' +
        sitKpi(sitFmt(k.vehEntradas), 'Vehículos de entrada', 'cámaras de tráfico (LPR)', '#2563eb') +
        sitKpi(sitFmt(k.vehSalidas), 'Vehículos de salida', 'cámaras de tráfico (LPR)', '#f59e0b') +
        sitKpi(sitFmt(k.peatones), 'Peatones (aforo)', 'paso total en accesos', '#0ea5e9') +
        sitKpi(k.puntosOk + ' / 9', 'Puntos de control con datos', k.puntosPend + ' pendientes de instalación', '#16a34a') +
      '</div>';
    var op = d.opinion ? '<div class="sit-opinion"><div class="sit-opinion-tit">🧭 Opinión profesional del periodo</div>' +
      d.opinion.split(/\n+/).filter(function (x) { return x.trim(); }).map(function (pp) { return '<p>' + sitEsc(pp.trim()) + '</p>'; }).join('') + '</div>' : '';
    var puntos = '<div class="sit-puntos">' + d.puntos.map(sitPuntoHtml).join('') + '</div>';
    var foot = '<div class="sit-foot">Fuente: cámaras LPR de tráfico y cámaras de aforo multiobjetivo (HikCentral). ' +
      (d.hayLPR ? '' : 'Este mes aún no dispone de datos de matrículas (LPR); los puntos de tráfico se completarán al subirse al sistema. ') +
      'Los puntos marcados «pendiente» requieren dar de alta o configurar cámaras por parte de la instalación.</div>';
    salida.innerHTML = head + op + puntos + foot;
  }
  function phKpi(valor, label, color) {
    return '<div class="sit-kpi"><div class="sit-kpi-val" style="color:' + color + '">' + valor + '</div><div class="sit-kpi-lbl">' + label + '</div></div>';
  }
  function phCamaras() {
    var set = {}, orden = [];
    (_sitData.meses || []).forEach(function (m) {
      (_sitData.datos[m].puntos || []).forEach(function (p) {
        if (p.porHora && (p.tipo === 'aforo' || p.tipo === 'lpr') && !set[p.titulo]) { set[p.titulo] = { titulo: p.titulo, tipo: p.tipo }; orden.push(set[p.titulo]); }
      });
    });
    return orden;
  }
  function phPunto(mes, titulo) {
    var d = _sitData.datos[mes]; if (!d) return null;
    return (d.puntos || []).find(function (p) { return p.titulo === titulo && p.porHora; }) || null;
  }
  function phRender() {
    var out = document.getElementById('ph-salida'); if (!out || !_sitData) return;
    var titulo = (document.getElementById('ph-cam') || {}).value;
    var mes = (document.getElementById('ph-mes') || {}).value;
    var p = phPunto(mes, titulo);
    if (_phChart) { try { _phChart.destroy(); } catch (_) {} _phChart = null; }
    if (!p) {
      out.innerHTML = '<div class="sit-card" style="padding:16px 18px"><p class="sit-pend-txt" style="color:#64748b">Sin datos horarios para <b>' + sitEsc(titulo) + '</b> en este mes.' + (/LPR|Est|Irta|Abellers/i.test(titulo) ? ' (las matrículas solo están disponibles hasta junio 2026).' : '') + '</p></div>';
      return;
    }
    var labels = []; for (var h = 0; h < 24; h++) labels.push((h < 10 ? '0' + h : h) + 'h');
    var esAforo = (p.tipo === 'aforo'), datasets, total;
    if (esAforo) {
      var ent = p.porHora.map(function (x) { return x.entrada; }), sal = p.porHora.map(function (x) { return x.salida; });
      total = ent.concat(sal).reduce(function (a, b) { return a + b; }, 0);
      datasets = [{ label: 'Entrada / subida', data: ent, backgroundColor: '#0ea5e9', borderRadius: 3 },
        { label: 'Salida / bajada', data: sal, backgroundColor: '#f59e0b', borderRadius: 3 }];
    } else {
      var tot = p.porHora.map(function (x) { return x.total; });
      total = tot.reduce(function (a, b) { return a + b; }, 0);
      datasets = [{ label: 'Vehículos', data: tot, backgroundColor: '#2563eb', borderRadius: 3 }];
    }
    var picoH = 0, picoV = -1;
    p.porHora.forEach(function (x, i) { var v = esAforo ? (x.entrada + x.salida) : x.total; if (v > picoV) { picoV = v; picoH = i; } });
    var kpis = '<div class="sit-kpis" style="margin-bottom:12px">' +
      phKpi(sitFmt(total), esAforo ? 'Peatones (paso total)' : 'Vehículos (paso total)', esAforo ? '#0ea5e9' : '#2563eb') +
      phKpi((picoH < 10 ? '0' + picoH : picoH) + ':00 h', 'Hora punta', '#7c3aed') +
      phKpi(sitFmt(picoV), 'Máximo en 1 hora', '#16a34a') + '</div>';
    out.innerHTML = kpis + '<div class="turismo-section-card"><h4 style="margin:0 0 .5rem;color:#475569;font-size:.95rem">' + sitEsc(titulo) + ' — perfil por horas (' + sitEsc(_sitData.datos[mes].periodoLabel) + ')</h4><div style="height:300px"><canvas id="ph-canvas"></canvas></div></div>';
    var ctx = document.getElementById('ph-canvas');
    if (ctx && typeof Chart !== 'undefined') {
      _phChart = new Chart(ctx, { type: 'bar', data: { labels: labels, datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: esAforo, position: 'bottom' }, tooltip: { callbacks: { label: function (x) { return (x.dataset.label ? x.dataset.label + ': ' : '') + (typeof tFmtNum === 'function' ? tFmtNum(x.raw) : x.raw); } } } },
          scales: { x: { stacked: esAforo, ticks: { maxRotation: 0, autoSkip: true } }, y: { stacked: esAforo, beginAtZero: true, ticks: { callback: function (v) { return typeof tFmtNum === 'function' ? tFmtNum(v) : v; } } } } } });
    }
  }
  var _sitProBound = false;
  function initSitProInforme() {
    var sel = document.getElementById('sitpro-mes'), btn = document.getElementById('sitpro-ver'), dl = document.getElementById('sitpro-dl');
    if (!sel || _sitProBound) return;
    fetch('data/informes_sit/manifest.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      var informes = (m && m.informes) || [];
      if (!informes.length) { sel.innerHTML = '<option value="">—</option>'; if (btn) btn.disabled = true; return; }
      sel.innerHTML = informes.map(function (i) { return '<option value="' + i.archivo + '">' + sitEsc(i.label) + '</option>'; }).join('');
      function urlDe(v) { return 'data/informes_sit/' + v + '?t=' + Date.now(); }
      function apply() {
        if (dl && sel.value) { dl.href = urlDe(sel.value); dl.setAttribute('download', sel.value); }
      }
      sel.addEventListener('change', apply); apply();
      if (btn) btn.addEventListener('click', function () { if (sel.value) window.open(urlDe(sel.value), '_blank'); });
      _sitProBound = true;
    }).catch(function () {});
  }

  function initSitCamaras() {
    initSitProInforme();
    var selC = document.getElementById('ph-cam'), selM = document.getElementById('ph-mes'), out = document.getElementById('ph-salida');
    if (!selC || !selM) return;
    if (out && !_sitData) out.innerHTML = '<p style="color:#94a3b8">Cargando…</p>';
    sitLoad().then(function (d) {
      if (!d || !d.meses || !d.meses.length) { if (out) out.innerHTML = '<p style="color:#64748b">No se pudieron cargar los datos por horas.</p>'; return; }
      if (!_phBound) {
        var cams = phCamaras();
        selC.innerHTML = cams.map(function (c) { return '<option value="' + sitEsc(c.titulo) + '">' + sitEsc(c.titulo) + (c.tipo === 'aforo' ? ' (peatones)' : ' (tráfico)') + '</option>'; }).join('');
        var meses = d.meses.slice().sort().reverse();
        selM.innerHTML = meses.map(function (m) { return '<option value="' + m + '">' + (d.datos[m] ? d.datos[m].periodoLabel : m) + '</option>'; }).join('');
        selC.addEventListener('change', phRender); selM.addEventListener('change', phRender);
        var firstAforo = cams.filter(function (c) { return c.tipo === 'aforo'; })[0];
        if (firstAforo) selC.value = firstAforo.titulo;
        _phBound = true;
      }
      if (!selM.value) selM.value = d.meses.slice().sort().reverse()[0];
      phRender();
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
          'grandes-productores': 'Residuos - Grandes productores (FOBESA)',
          mapa: 'Residuos - Mapa de contenedores',
          zonas: 'Residuos - Por zonas',
          'comparacion-tipos': 'Residuos - Comparación por tipo',
          tablas: 'Residuos - Tablas',
          'residuos-informes': 'Residuos - Informes'
        };
        if (h2R && residTitles[el.dataset.section]) h2R.textContent = residTitles[el.dataset.section];
        // La barra de filtros global (año/mes/comparar) no aplica a Grandes productores
        // ni a Informes (tienen sus propios filtros): se oculta para no confundir.
        var barraResiduos = document.getElementById('residuos-filters-bar');
        var resSinBarra = ['grandes-productores', 'residuos-informes'];
        if (barraResiduos) barraResiduos.style.display = resSinBarra.indexOf(el.dataset.section) >= 0 ? 'none' : '';
        if (el.dataset.section === 'grandes-productores') setTimeout(renderGrandesProductores, 60);
        else if (el.dataset.section === 'residuos-informes') setTimeout(function () { initInformesSection('residuos'); }, 60);
        else setTimeout(function () { updateResiduosKPIs(); }, 100);
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

  // Etiqueta y filtro de categorías con datos (apartamentos en Peñíscola va vacío).
  function turismoCatLabel(c) { return c[0].toUpperCase() + c.slice(1); }
  function turismoCatsConDatos(cats) {
    return cats.filter((c) => (turismoData.series[c] || []).some((s) => (s.data || []).length));
  }

  // Selección de años por gráfica anual (canvasId -> array de años string).
  const turismoAnualSel = {};
  const TURISMO_ANUAL_PALETTE = ['#f97316', '#ec4899', '#0ea5e9', '#facc15', '#14b8a6', '#7c3aed', '#22c55e', '#a855f7', '#06b6d4', '#ef4444', '#3b82f6', '#10b981'];

  // Inserta una sola vez el desplegable de años junto a la gráfica anual.
  function ensureTurismoAnualDropdown(canvasId, cat, anyos, metrica) {
    const ddId = canvasId + '-yeardd';
    if (document.getElementById(ddId)) return;
    const ctx = document.getElementById(canvasId);
    const card = ctx && ctx.closest('.turismo-chart-card');
    const cont = ctx && ctx.closest('.chart-container');
    if (!card || !cont) return;
    const sel = turismoAnualSel[canvasId] || [];
    const dd = document.createElement('details');
    dd.className = 'turismo-year-dd';
    dd.id = ddId;
    dd.innerHTML =
      '<summary><span class="ty-ico">📅</span> Años a comparar <span class="ty-count">(' + sel.length + ')</span></summary>' +
      '<div class="turismo-year-dd-panel">' +
        '<div class="turismo-year-dd-acts"><button type="button" data-act="all">Todos</button><button type="button" data-act="last5">Últimos 5</button><button type="button" data-act="none">Ninguno</button></div>' +
        '<div class="turismo-year-dd-list">' +
          anyos.slice().reverse().map((y) => '<label><input type="checkbox" value="' + y + '"' + (sel.indexOf(y) >= 0 ? ' checked' : '') + '> ' + y + '</label>').join('') +
        '</div>' +
      '</div>';
    card.insertBefore(dd, cont);
    const setCount = (n) => { const c = dd.querySelector('.ty-count'); if (c) c.textContent = '(' + n + ')'; };
    dd.addEventListener('change', (e) => {
      if (!(e.target && e.target.matches && e.target.matches('input[type=checkbox]'))) return;
      const checked = Array.prototype.slice.call(dd.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.value);
      turismoAnualSel[canvasId] = checked;
      setCount(checked.length);
      renderTurismoCategoriaAnualChart(canvasId, cat, metrica);
    });
    dd.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      e.preventDefault();
      let next = act === 'all' ? anyos.slice() : act === 'last5' ? anyos.slice(-5) : [];
      turismoAnualSel[canvasId] = next;
      dd.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = next.indexOf(c.value) >= 0; });
      setCount(next.length);
      renderTurismoCategoriaAnualChart(canvasId, cat, metrica);
    });
  }

  function renderTurismoCategoriaAnualChart(canvasId, cat, metrica) {
    metrica = metrica || 'pernoctaciones';
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const series = (turismoData.series[cat] || []).filter((s) => s.metrica === metrica);
    if (!series.length || !series.some((s) => (s.data || []).length)) {
      destroyTurismoChart(canvasId);
      ctx.parentElement.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Sin datos publicados.</p>';
      return;
    }
    const porAnyo = {};
    series.forEach((s) => (s.data || []).forEach((d) => {
      if (!d.mes) return;
      if (!porAnyo[d.anyo]) porAnyo[d.anyo] = Array(12).fill(0);
      porAnyo[d.anyo][d.mes - 1] += d.valor;
    }));
    const anyos = Object.keys(porAnyo).sort();
    // Por defecto: últimos 5 años (para no saturar). Luego respeta la selección del usuario.
    let sel = (turismoAnualSel[canvasId] || anyos.slice(-5)).filter((y) => anyos.indexOf(y) >= 0);
    if (!sel.length && !turismoAnualSel[canvasId]) sel = anyos.slice(-5);
    turismoAnualSel[canvasId] = sel;
    ensureTurismoAnualDropdown(canvasId, cat, anyos, metrica);

    destroyTurismoChart(canvasId);
    turismoCharts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: MESES_CORTOS,
        datasets: sel.map((y) => {
          const color = TURISMO_ANUAL_PALETTE[anyos.indexOf(y) % TURISMO_ANUAL_PALETTE.length];
          return {
            label: String(y),
            data: porAnyo[y],
            borderColor: color,
            backgroundColor: color + '22',
            tension: 0.3,
            fill: false,
            pointRadius: 3
          };
        })
      },
      options: turismoChartDefaults()
    });
  }

  // Hoteles: ocupación y empleo (KPIs + comparación anual de ocupación, filtrable por años).
  function renderTurismoOcupacionEmpleo() {
    if (!turismoData) return;
    const r = (turismoData.resumen && turismoData.resumen.hoteles) || {};
    const pct = (v) => (v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + ' %');
    const cont = document.getElementById('turismo-mini-ocupacion');
    if (cont) {
      cont.innerHTML = [
        { l: 'Grado de ocupación', v: pct(r.ultimoGradoOcupacion), sub: 'por plazas (último mes)' },
        { l: 'Personal empleado', v: (r.ultimoPersonal != null ? tFmtNum(r.ultimoPersonal) : '—'), sub: 'en hoteles (último mes)' }
      ].map((it) => `<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">${it.l}</span><span class="turismo-mini-kpi-value">${it.v}</span>${it.sub ? `<span class="turismo-mini-kpi-sub">${it.sub}</span>` : ''}</div>`).join('');
    }
    renderTurismoCategoriaAnualChart('chart-turismo-hoteles-ocupacion', 'hoteles', 'grado_ocupacion');
  }

  // Sección Rentabilidad: ADR y RevPAR — KPIs, evolución mensual y comparación anual filtrable.
  function renderTurismoRentabilidad() {
    if (!turismoData) return;
    const series = turismoData.series.hoteles || [];
    const adr = series.find((s) => s.metrica === 'adr');
    const revpar = series.find((s) => s.metrica === 'revpar');
    const r = (turismoData.resumen && turismoData.resumen.hoteles) || {};
    const eur = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + ' €');
    const cont = document.getElementById('turismo-mini-rentabilidad');
    if (cont) {
      cont.innerHTML = [
        { l: 'ADR (último mes)', v: eur(r.ultimoAdr), sub: r.ultimoAdrMes ? fechaLabelTurismo(r.ultimoAdrMes) : '' },
        { l: 'RevPAR (último mes)', v: eur(r.ultimoRevpar), sub: r.ultimoRevparMes ? fechaLabelTurismo(r.ultimoRevparMes) : '' }
      ].map((it) => `<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">${it.l}</span><span class="turismo-mini-kpi-value">${it.v}</span>${it.sub ? `<span class="turismo-mini-kpi-sub">${it.sub}</span>` : ''}</div>`).join('');
    }
    // Evolución mensual ADR + RevPAR (últimos 36 meses)
    destroyTurismoChart('rentab-mensual');
    const ctx = document.getElementById('chart-turismo-rentab-mensual');
    if (ctx) {
      if (!adr && !revpar) { ctx.parentElement.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Sin datos publicados.</p>'; }
      else {
        const mapADR = {}; (adr && adr.data || []).forEach((d) => { mapADR[d.fecha] = d.valor; });
        const mapRev = {}; (revpar && revpar.data || []).forEach((d) => { mapRev[d.fecha] = d.valor; });
        const fechas = Array.from(new Set(Object.keys(mapADR).concat(Object.keys(mapRev)))).sort().slice(-36);
        turismoCharts['rentab-mensual'] = new Chart(ctx, {
          type: 'line',
          data: {
            labels: fechas.map(fechaLabelTurismo),
            datasets: [
              { label: 'ADR (€)', data: fechas.map((f) => (mapADR[f] != null ? mapADR[f] : null)), borderColor: '#7c3aed', backgroundColor: '#7c3aed22', tension: 0.3, fill: false, pointRadius: 2, spanGaps: true },
              { label: 'RevPAR (€)', data: fechas.map((f) => (mapRev[f] != null ? mapRev[f] : null)), borderColor: '#0ea5e9', backgroundColor: '#0ea5e922', tension: 0.3, fill: false, pointRadius: 2, spanGaps: true }
            ]
          },
          options: turismoChartDefaults()
        });
      }
    }
    // Comparación anual filtrable (una línea por año) para ADR y RevPAR
    renderTurismoCategoriaAnualChart('chart-turismo-adr-anual', 'hoteles', 'adr');
    renderTurismoCategoriaAnualChart('chart-turismo-revpar-anual', 'hoteles', 'revpar');
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
    // Solo categorías con datos (en Peñíscola apartamentos va vacío → se omite).
    const cats = turismoCatsConDatos(['hoteles', 'apartamentos', 'campings']);
    const VENTANA_MESES = 24; // las gráficas "por mes" muestran los últimos 24 meses (serie temporal real).
    const perCat = {};
    cats.forEach((cat) => {
      perCat[cat] = {
        viajeros: turismoSeriesPorMes(turismoData.series[cat] || [], { metrica: 'viajeros' }),
        pernoctaciones: turismoSeriesPorMes(turismoData.series[cat] || [], { metrica: 'pernoctaciones' })
      };
    });
    const fechasSet = new Set();
    cats.forEach((cat) => {
      Object.keys(perCat[cat].viajeros).forEach((k) => fechasSet.add(k));
      Object.keys(perCat[cat].pernoctaciones).forEach((k) => fechasSet.add(k));
    });
    const labels = Array.from(fechasSet).sort().slice(-VENTANA_MESES);
    const buildDatasets = (metrica) => cats.map((cat) => ({
      label: turismoCatLabel(cat),
      data: labels.map((f) => perCat[cat][metrica][f] || 0),
      borderColor: TURISMO_COLORS[cat], backgroundColor: TURISMO_COLORS[cat] + '33',
      fill: false, tension: 0.3, pointRadius: 2
    }));
    destroyTurismoChart('comp-viajeros');
    const ctxV = document.getElementById('chart-turismo-comp-viajeros');
    if (ctxV) turismoCharts['comp-viajeros'] = new Chart(ctxV, { type: 'line', data: { labels: labels.map(fechaLabelTurismo), datasets: buildDatasets('viajeros') }, options: turismoChartDefaults() });
    destroyTurismoChart('comp-pern');
    const ctxP = document.getElementById('chart-turismo-comp-pern');
    if (ctxP) turismoCharts['comp-pern'] = new Chart(ctxP, { type: 'line', data: { labels: labels.map(fechaLabelTurismo), datasets: buildDatasets('pernoctaciones') }, options: turismoChartDefaults() });
    // Reparto y comparación anual: totales del último año (del resumen del INE).
    const r = turismoData.resumen || {};
    const actuales = cats.map((c) => (r[c] && r[c].totalPernoctacionesAnyo) || 0);
    const previos = cats.map((c) => (r[c] && r[c].totalPernoctacionesAnyoAnterior) || 0);
    destroyTurismoChart('comp-reparto');
    const ctxR = document.getElementById('chart-turismo-comp-reparto');
    if (ctxR) turismoCharts['comp-reparto'] = new Chart(ctxR, { type: 'doughnut', data: { labels: cats.map(turismoCatLabel), datasets: [{ data: actuales, backgroundColor: cats.map((c) => TURISMO_COLORS[c]), borderColor: '#ffffff', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } } });
    destroyTurismoChart('comp-anio');
    const ctxA = document.getElementById('chart-turismo-comp-anio');
    if (ctxA) turismoCharts['comp-anio'] = new Chart(ctxA, {
      type: 'bar',
      data: { labels: cats.map(turismoCatLabel), datasets: [
        { label: 'Año actual', data: actuales, backgroundColor: TURISMO_COLORS.hoteles, borderRadius: 4 },
        { label: 'Año anterior', data: previos, backgroundColor: '#8b949e', borderRadius: 4 }
      ] },
      options: turismoChartDefaults()
    });
  }

  function renderTurismoTablas() {
    // Tablas con TODOS los años (sin filtrar por el selector de año/mes).
    const buildTable = (cat) => {
      const series = turismoData.series[cat] || [];
      if (!series.length || !series.some((s) => (s.data || []).length)) return '<p style="padding:0.5rem;color:var(--text-muted)">Sin datos publicados por el INE.</p>';
      const fechas = new Set();
      series.forEach((s) => (s.data || []).forEach((d) => fechas.add(d.fecha)));
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
    const elC = document.getElementById('turismo-tabla-campings');
    if (elH) elH.innerHTML = buildTable('hoteles');
    if (elC) elC.innerHTML = buildTable('campings');
    const tag = document.getElementById('turismo-tablas-tag');
    if (tag) tag.textContent = 'Todos los años';
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
    // Presión turística (en %): turistas extranjeros del mes ÷ habitantes × 100
    if (r.presionTuristica && r.presionTuristica.habitantes) {
      const pct = (r.presionTuristica.turistas / r.presionTuristica.habitantes) * 100;
      setText('turismo-ctx-presion', pct.toFixed(1).replace('.', ',') + '%');
    }
    // Plazas turísticas: plazas hoteleras + plazas de camping (capacidad total estimada)
    const plazasHotel = (r.hoteles && r.hoteles.ultimasPlazas) || 0;
    const plazasCamp = (r.campings && r.campings.ultimasPlazas) || 0;
    if (plazasHotel || plazasCamp) {
      setText('turismo-ctx-plazas', tFmtNum(plazasHotel + plazasCamp));
      setText('turismo-ctx-plazas-sub', tFmtNum(plazasHotel) + ' hotel · ' + tFmtNum(plazasCamp) + ' camping');
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

  // ====== Procedencia nacional (turistas españoles por CCAA / provincia) ======
  function renderTurismoProcedencia() {
    if (!turismoData) return;
    var proc = (turismoData.series && turismoData.series.procedencia) || [];
    if (!proc.length) return;
    var fechas = new Set();
    proc.forEach(function (s) { (s.data || []).forEach(function (d) { fechas.add(d.fecha); }); });
    var ult12 = Array.from(fechas).sort().slice(-12);
    var sumSerie = function (s) { return (s.data || []).filter(function (d) { return ult12.indexOf(d.fecha) >= 0; }).reduce(function (a, b) { return a + (b.valor || 0); }, 0); };
    var mapRank = function (residencia) {
      return proc.filter(function (s) { return s.residencia === residencia && s.nombre !== 'Total Nacional'; })
        .map(function (s) { return { n: s.nombre, v: sumSerie(s) }; })
        .filter(function (x) { return x.v > 0; })
        .sort(function (a, b) { return b.v - a.v; });
    };
    var ccaa = mapRank('ccaa');
    var prov = mapRank('provincia');
    var totalNac = proc.find(function (s) { return s.nombre === 'Total Nacional'; });
    var ultMes = ult12.length ? ult12[ult12.length - 1] : '';
    var totalCcaa = ccaa.reduce(function (a, b) { return a + b.v; }, 0);
    var cont = document.getElementById('turismo-mini-procedencia');
    if (cont) {
      cont.innerHTML = [
        { l: 'Último mes', v: ultMes ? fechaLabelTurismo(ultMes) : '—' },
        { l: 'Turistas nacionales (12 m)', v: tFmtNum(totalCcaa) },
        { l: 'CCAA top', v: ccaa[0] ? ccaa[0].n : '—', sub: ccaa[0] ? tFmtNum(ccaa[0].v) + ' turistas' : '' },
        { l: 'Provincia top', v: prov[0] ? prov[0].n : '—', sub: prov[0] ? tFmtNum(prov[0].v) + ' turistas' : '' }
      ].map(function (it) { return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + it.l + '</span><span class="turismo-mini-kpi-value">' + it.v + '</span>' + (it.sub ? '<span class="turismo-mini-kpi-sub">' + it.sub + '</span>' : '') + '</div>'; }).join('');
    }
    var pal = ['#2563eb', '#0891b2', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0ea5e9', '#14b8a6', '#facc15', '#ec4899', '#8b5cf6', '#f97316'];
    var hbarOpts = function (fontY) {
      var base = turismoChartDefaults();
      return Object.assign({}, base, {
        indexAxis: 'y',
        plugins: Object.assign({}, base.plugins, { legend: { display: false } }),
        scales: {
          x: { ticks: { color: '#64748b', callback: function (v) { return tFmtNum(v); } }, grid: { color: 'rgba(226, 232, 240, 0.7)' } },
          y: { ticks: { color: '#0f172a', font: { size: fontY, weight: '600' } }, grid: { display: false } }
        }
      });
    };
    destroyTurismoChart('proc-ccaa');
    var c1 = document.getElementById('chart-turismo-proc-ccaa');
    if (c1) {
      var topC = ccaa.slice(0, 12);
      turismoCharts['proc-ccaa'] = new Chart(c1, { type: 'bar', data: { labels: topC.map(function (x) { return x.n; }), datasets: [{ label: 'Turistas', data: topC.map(function (x) { return x.v; }), backgroundColor: topC.map(function (_, i) { return pal[i % pal.length]; }), borderRadius: 4 }] }, options: hbarOpts(12) });
    }
    destroyTurismoChart('proc-prov');
    var c2 = document.getElementById('chart-turismo-proc-prov');
    if (c2) {
      var topP = prov.slice(0, 15);
      turismoCharts['proc-prov'] = new Chart(c2, { type: 'bar', data: { labels: topP.map(function (x) { return x.n; }), datasets: [{ label: 'Turistas', data: topP.map(function (x) { return x.v; }), backgroundColor: '#0891b2', borderRadius: 4 }] }, options: hbarOpts(11) });
    }
    destroyTurismoChart('proc-mes');
    var c3 = document.getElementById('chart-turismo-proc-mes');
    if (c3 && totalNac) {
      var d = totalNac.data || [];
      turismoCharts['proc-mes'] = new Chart(c3, { type: 'bar', data: { labels: d.map(function (x) { return fechaLabelTurismo(x.fecha); }), datasets: [{ label: 'Turistas nacionales', data: d.map(function (x) { return x.valor; }), backgroundColor: '#2563eb', borderRadius: 4 }] }, options: turismoChartDefaults() });
    }
  }

  // ====== Gasto turístico (SIT CV / Geoblink) — dato manual ======
  var _sitGasto = null;
  function renderTurismoGasto() {
    var pct = function (p) { if (p == null) return ''; return (p >= 0 ? '▲ +' : '▼ ') + String(p).replace('.', ',') + '%'; };
    var render = function (d) {
      if (!d || !d.kpis) return;
      var k = d.kpis;
      var per = document.getElementById('turismo-gasto-periodo');
      if (per) per.textContent = (d.periodo ? '· ' + d.periodo : '') + (d.actualizado ? ' · actualizado ' + d.actualizado : '');
      var eur = function (n) { return n >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M€' : tFmtNum(Math.round(n)) + ' €'; };
      // Filtro Origen (liga una vez): reparte gasto/tickets/tarjetas por el % nacional/extranjero
      var selO = document.getElementById('gasto-origen');
      if (selO && selO.dataset.bound !== '1') { selO.addEventListener('change', function () { render(d); }); selO.dataset.bound = '1'; }
      var origen = selO ? selO.value : '';
      var frac = origen === 'nacional' ? (k.pctNacional / 100) : origen === 'extranjero' ? (k.pctExtranjero / 100) : 1;
      var etq = origen === 'nacional' ? ' (nacional)' : origen === 'extranjero' ? ' (extranjero)' : '';
      var cont = document.getElementById('turismo-gasto-kpis');
      if (cont) cont.innerHTML = [
        { l: 'Gasto total' + etq, v: eur(k.gastoTotalEur * frac), sub: origen ? (String(origen === 'nacional' ? k.pctNacional : k.pctExtranjero).replace('.', ',') + '% del total') : pct(k.gastoVarPct) },
        { l: 'Ticket medio', v: String(k.ticketMedioEur).replace('.', ',') + ' €', sub: pct(k.ticketMedioVarPct) },
        { l: 'Nº de tickets' + etq, v: tFmtNum(Math.round(k.ticketsTotales * frac)), sub: origen ? 'estimado por %' : pct(k.ticketsVarPct) },
        { l: 'Nº de tarjetas' + etq, v: tFmtNum(Math.round(k.numTarjetas * frac)), sub: origen ? 'estimado por %' : pct(k.tarjetasVarPct) },
        { l: origen ? '% del gasto' : '% gasto extranjero', v: String(origen === 'nacional' ? k.pctNacional : k.pctExtranjero).replace('.', ',') + ' %', sub: 'del total' }
      ].map(function (it) { return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + it.l + '</span><span class="turismo-mini-kpi-value">' + it.v + '</span>' + (it.sub ? '<span class="turismo-mini-kpi-sub">' + it.sub + '</span>' : '') + '</div>'; }).join('');
      destroyTurismoChart('gasto-origen');
      var c = document.getElementById('chart-turismo-gasto-origen');
      var gcol = [origen === 'extranjero' ? '#bfdbfe' : '#2563eb', origen === 'nacional' ? '#fed7aa' : '#f59e0b'];
      if (c) turismoCharts['gasto-origen'] = new Chart(c, { type: 'doughnut', data: { labels: ['Nacionales', 'Extranjeras'], datasets: [{ data: [k.pctNacional, k.pctExtranjero], backgroundColor: gcol }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
    };
    if (_sitGasto) { render(_sitGasto); return; }
    var url = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/sit_gasto_manual.json') : '/data/TURISMO/sit_gasto_manual.json';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { _sitGasto = d; render(d); }).catch(function () {});
  }

  var _sitBusquedas = null;
  function renderTurismoBusquedas() {
    var pct = function (p) { if (p == null) return ''; return (p >= 0 ? '▲ +' : '▼ ') + String(p).replace('.', ',') + '%'; };
    var render = function (d) {
      if (!d || !d.kpis) return;
      var serie = d.serieAnual || [{ anio: d.kpis.anio, turistas: d.kpis.turistas, reservas: d.kpis.reservas, turistasVarPct: d.kpis.turistasVarPct, reservasVarPct: d.kpis.reservasVarPct }];
      // Selector de año (se rellena/liga una sola vez): "Todos" + cada año de la serie
      var selA = document.getElementById('busq-anio');
      if (selA && selA.dataset.bound !== '1') {
        selA.innerHTML = '<option value="">Todos los años</option>' + serie.slice().reverse().map(function (x) { return '<option value="' + x.anio + '">' + x.anio + '</option>'; }).join('');
        selA.addEventListener('change', function () { render(d); });
        selA.dataset.bound = '1';
      }
      var anioSel = selA ? selA.value : '';
      var k = anioSel ? (serie.find(function (x) { return String(x.anio) === anioSel; }) || d.kpis) : serie[serie.length - 1];
      var per = document.getElementById('turismo-busquedas-periodo');
      if (per) per.textContent = (d.periodo ? '· ' + d.periodo : '') + (d.actualizado ? ' · actualizado ' + d.actualizado : '');
      var cont = document.getElementById('turismo-busquedas-kpis');
      if (cont) cont.innerHTML = [
        { l: 'Turistas (' + k.anio + ')', v: tFmtNum(k.turistas), sub: pct(k.turistasVarPct) },
        { l: 'Reservas (' + k.anio + ')', v: tFmtNum(k.reservas), sub: pct(k.reservasVarPct) },
        { l: 'Reservas por turista', v: (k.reservas / k.turistas).toLocaleString('es-ES', { maximumFractionDigits: 2 }), sub: 'ratio' }
      ].map(function (it) { return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + it.l + '</span><span class="turismo-mini-kpi-value">' + it.v + '</span>' + (it.sub ? '<span class="turismo-mini-kpi-sub">' + it.sub + '</span>' : '') + '</div>'; }).join('');
      destroyTurismoChart('busquedas');
      var c = document.getElementById('chart-turismo-busquedas');
      // Resalta el año seleccionado en el gráfico (los demás atenuados)
      var barColor = serie.map(function (x) { return (!anioSel || String(x.anio) === anioSel) ? '#2563eb' : '#c7d2fe'; });
      var ptColor = serie.map(function (x) { return (!anioSel || String(x.anio) === anioSel) ? '#f59e0b' : '#fde68a'; });
      if (c) turismoCharts['busquedas'] = new Chart(c, {
        type: 'bar',
        data: {
          labels: serie.map(function (x) { return x.anio; }),
          datasets: [
            { type: 'bar', label: 'Turistas', data: serie.map(function (x) { return x.turistas; }), backgroundColor: barColor, yAxisID: 'y', order: 2 },
            { type: 'line', label: 'Reservas', data: serie.map(function (x) { return x.reservas; }), borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointBackgroundColor: ptColor, pointBorderColor: ptColor, tension: 0.3, pointRadius: 5, yAxisID: 'y1', order: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + tFmtNum(ctx.raw); } } } },
          scales: {
            y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Turistas' } },
            y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Reservas' } }
          }
        }
      });
    };
    if (_sitBusquedas) { render(_sitBusquedas); return; }
    var url = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/sit_busquedas_manual.json') : '/data/TURISMO/sit_busquedas_manual.json';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { _sitBusquedas = d; render(d); }).catch(function () {});
  }

  var _sitReputacion = null;
  function renderTurismoReputacion() {
    var render = function (d) {
      if (!d || !d.kpis) return;
      var k = d.kpis, s = d.sentimiento || {};
      var per = document.getElementById('turismo-reputacion-periodo');
      if (per) per.textContent = (d.periodo ? '· ' + d.periodo : '') + (d.actualizado ? ' · actualizado ' + d.actualizado : '');
      var abrev = function (n) { if (n >= 1e6) return (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' M'; if (n >= 1e3) return (n / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' mil'; return tFmtNum(Math.round(n)); };
      // Filtro Sentimiento (liga una vez): filtra menciones/impresiones/alcance por tono
      var selS = document.getElementById('reput-sent');
      if (selS && selS.dataset.bound !== '1') { selS.addEventListener('change', function () { render(d); }); selS.dataset.bound = '1'; }
      var sent = selS ? selS.value : '';
      var sentLbl = { muyPositiva: 'Muy positiva', positiva: 'Positiva', neutra: 'Neutra', muyNegativa: 'Muy negativa' };
      var totSent = (s.muyPositiva || 0) + (s.positiva || 0) + (s.neutra || 0) + (s.muyNegativa || 0);
      var menSel = sent ? (s[sent] || 0) : k.menciones;
      var fracS = (sent && totSent) ? (s[sent] / totSent) : 1;
      var etq = sent ? ' (' + sentLbl[sent].toLowerCase() + ')' : '';
      var cont = document.getElementById('turismo-reputacion-kpis');
      if (cont) cont.innerHTML = [
        { l: 'Menciones' + etq, v: tFmtNum(menSel), sub: sent ? ((100 * fracS).toFixed(1).replace('.', ',') + '% del total') : 'en redes y medios' },
        { l: 'Impresiones' + etq, v: abrev(k.impresiones * fracS), sub: sent ? 'estimado por %' : 'veces mostradas' },
        { l: 'Alcance' + etq, v: abrev(k.alcance * fracS), sub: sent ? 'estimado por %' : 'cuentas alcanzadas' },
        { l: '% menciones positivas', v: String(s.pctPositivas).replace('.', ',') + ' %', sub: 'del total' }
      ].map(function (it) { return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + it.l + '</span><span class="turismo-mini-kpi-value">' + it.v + '</span>' + (it.sub ? '<span class="turismo-mini-kpi-sub">' + it.sub + '</span>' : '') + '</div>'; }).join('');
      destroyTurismoChart('reputacion');
      var c = document.getElementById('chart-turismo-reputacion');
      var keys = ['muyPositiva', 'positiva', 'neutra', 'muyNegativa'];
      var baseCol = ['#16a34a', '#86efac', '#cbd5e1', '#ef4444'];
      var dimCol = ['#bbf7d0', '#dcfce7', '#f1f5f9', '#fecaca'];
      var col = keys.map(function (kk, i) { return (!sent || sent === kk) ? baseCol[i] : dimCol[i]; });
      if (c) turismoCharts['reputacion'] = new Chart(c, { type: 'doughnut', data: { labels: ['Muy positiva', 'Positiva', 'Neutra', 'Muy negativa'], datasets: [{ data: [s.muyPositiva, s.positiva, s.neutra, s.muyNegativa], backgroundColor: col }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
    };
    if (_sitReputacion) { render(_sitReputacion); return; }
    var url = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/sit_reputacion_manual.json') : '/data/TURISMO/sit_reputacion_manual.json';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { _sitReputacion = d; render(d); }).catch(function () {});
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

  // ====== Viviendas turísticas (GVA) ======
  let viviendasData = null;
  function ensureViviendasLoaded() {
    if (viviendasData) return Promise.resolve(viviendasData);
    const url = (typeof dataUrl === 'function') ? dataUrl('data/TURISMO/viviendas.json') : '/data/TURISMO/viviendas.json';
    return fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { viviendasData = d; return d; })
      .catch(() => null);
  }

  function renderTurismoViviendas() {
    if (!viviendasData) return;
    const r = viviendasData.resumen || {};
    const cont = document.getElementById('turismo-mini-viviendas');
    if (cont) {
      cont.innerHTML = [
        { l: 'Viviendas registradas', v: tFmtNum(r.viviendas_totales) },
        { l: 'Plazas totales', v: tFmtNum(r.plazas_totales) },
        { l: 'Plazas / vivienda', v: tFmtDec(r.plazas_por_vivienda, 2) },
        { l: 'Superficie media', v: tFmtNum(r.superficie_media_m2) + ' m²' },
        { l: 'Dormitorios totales', v: tFmtNum(r.dormitorios_totales) },
        { l: '% estudios', v: tFmtDec(r.pct_estudios, 1) + '%' }
      ].map((it) => `<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">${it.l}</span><span class="turismo-mini-kpi-value">${it.v}</span></div>`).join('');
    }

    // Chart altas anuales (bar) + plazas acumuladas (line)
    const altas = viviendasData.altasPorAnyo || {};
    const acum = viviendasData.plazasAcum || {};
    const anyos = Object.keys(altas).sort();
    destroyTurismoChart('viviendas-altas');
    const ctxA = document.getElementById('chart-viviendas-altas');
    if (ctxA) {
      const base = turismoChartDefaults();
      turismoCharts['viviendas-altas'] = new Chart(ctxA, {
        data: {
          labels: anyos,
          datasets: [
            { type: 'bar', label: 'Nuevas altas', data: anyos.map((y) => altas[y] || 0), backgroundColor: TURISMO_COLORS.hoteles, borderRadius: 4, yAxisID: 'y' },
            { type: 'line', label: 'Plazas acumuladas', data: anyos.map((y) => acum[y]?.plazas || 0), borderColor: '#e6157f', backgroundColor: 'rgba(230,21,127,0.15)', tension: 0.35, pointRadius: 3, fill: false, yAxisID: 'y1' }
          ]
        },
        options: {
          ...base,
          scales: {
            x: base.scales.x,
            y: { ...base.scales.y, title: { display: true, text: 'Altas/año', color: '#64748b' } },
            y1: { position: 'right', grid: { display: false }, ticks: { color: '#64748b', callback: (v) => tFmtNum(v) }, title: { display: true, text: 'Plazas acum.', color: '#64748b' } }
          }
        }
      });
    }

    // Chart distribución por tamaño (donut)
    const dist = viviendasData.distribucionTamano || {};
    const labels = ['1-2 plazas', '3-4 plazas', '5-6 plazas', '7-8 plazas', '9+ plazas'];
    const keys = ['1-2', '3-4', '5-6', '7-8', '9+'];
    const colors = ['#0ea5e9', '#2563eb', '#059669', '#d97706', '#e6157f'];
    destroyTurismoChart('viviendas-tamano');
    const ctxT = document.getElementById('chart-viviendas-tamano');
    if (ctxT) {
      turismoCharts['viviendas-tamano'] = new Chart(ctxT, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: keys.map((k) => dist[k] || 0), backgroundColor: colors, borderColor: '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
      });
    }

    // Chart por código postal (barras horizontales)
    const porCp = viviendasData.porCp || {};
    const cps = Object.entries(porCp).filter(([cp]) => cp && cp !== 'sin CP').sort((a, b) => b[1].plazas - a[1].plazas).slice(0, 8);
    destroyTurismoChart('viviendas-cp');
    const ctxC = document.getElementById('chart-viviendas-cp');
    if (ctxC) {
      const base = turismoChartDefaults();
      turismoCharts['viviendas-cp'] = new Chart(ctxC, {
        type: 'bar',
        data: { labels: cps.map(([cp]) => cp), datasets: [{ label: 'Plazas', data: cps.map(([, v]) => v.plazas), backgroundColor: TURISMO_COLORS.apartamentos, borderRadius: 4 }] },
        options: {
          ...base,
          indexAxis: 'y',
          plugins: { ...base.plugins, legend: { display: false } },
          scales: {
            x: { ticks: { color: '#64748b', callback: (v) => tFmtNum(v) }, grid: { color: 'rgba(226,232,240,0.7)' } },
            y: { ticks: { color: '#0f172a', font: { size: 12, weight: '600' } }, grid: { display: false } }
          }
        }
      });
    }

    // Tabla top 10
    const top = viviendasData.top10 || [];
    const tab = document.getElementById('tabla-viviendas-top');
    if (tab) {
      const rows = top.map((v) => `<tr><td>${v.signatura || '—'}</td><td>${v.nombre || '—'}</td><td>${v.direccion || '—'}</td><td>${tFmtNum(v.plazas)}</td><td>${tFmtNum(v.dormitorios)}</td><td>${tFmtNum(v.superficie_m2)} m²</td></tr>`).join('');
      tab.innerHTML = `<table class="data-table"><thead><tr><th>Signatura</th><th>Nombre</th><th>Dirección</th><th>Plazas</th><th>Dormitorios</th><th>Superficie</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    renderTurismoProcedencia();
    renderTurismoGasto();
    renderTurismoBusquedas();
    renderTurismoReputacion();
    ensureViviendasLoaded().then((d) => { if (d) renderTurismoViviendas(); });
    renderTurismoCategoriaMesChart('chart-turismo-hoteles-mes', 'hoteles');
    renderTurismoCategoriaOrigenChart('chart-turismo-hoteles-origen', 'hoteles');
    renderTurismoOcupacionEmpleo();
    renderTurismoCategoriaAnualChart('chart-turismo-hoteles-anual', 'hoteles');
    renderTurismoRentabilidad();
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
            'turismo-procedencia': 'Turismo - Procedencia nacional (CCAA y provincias)',
            'turismo-gasto': 'Turismo - Gasto con tarjeta (SIT CV)',
            'turismo-busquedas': 'Turismo - Demanda online de alquiler vacacional (SIT CV)',
            'turismo-reputacion': 'Turismo - Reputación y escucha del destino (SIT CV)',
            'turismo-hoteles': 'Turismo - Hoteles',
            'turismo-rentabilidad': 'Turismo - Rentabilidad',
            'turismo-apartamentos': 'Turismo - Apartamentos',
            'turismo-campings': 'Turismo - Campings',
            'turismo-viviendas': 'Turismo - Viviendas turísticas (GVA)',
            'turismo-comparativa': 'Turismo - Comparativa',
            'turismo-tablas': 'Turismo - Tablas INE',
            'turismo-fuentes': 'Turismo - Fuentes de datos',
            'turismo-informes': 'Turismo - Informes'
          };
          const h2 = header.querySelector('h2');
          if (h2 && titles[el.dataset.section]) h2.textContent = titles[el.dataset.section];
        }
        // Las secciones del SIT-CV (gasto/demanda/reputación) traen sus propios
        // datos/periodo y NO dependen de la barra global año/mes/categoría de
        // turismo: se oculta esa barra en ellas para que no parezca que "no filtra".
        const barTur = document.querySelector('#main-turismo .turismo-filters-bar');
        const sitSecs = ['turismo-gasto', 'turismo-busquedas', 'turismo-reputacion', 'turismo-informes'];
        if (barTur) barTur.style.display = sitSecs.indexOf(el.dataset.section) >= 0 ? 'none' : '';
        if (el.dataset.section === 'turismo-informes') setTimeout(function () { initInformesSection('turismo'); }, 60);
        else setTimeout(() => renderTurismoAll(), 80);
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

  function initLanding() {
    document.querySelectorAll('#main-landing .landing-card').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const target = btn.getAttribute('data-target');
        if (target) setMode(target);
      });
    });
    const logoLink = document.getElementById('logo-home');
    if (logoLink) {
      logoLink.addEventListener('click', function (e) {
        e.preventDefault();
        setMode('landing');
      });
    }
    // Estado inicial: forzamos landing por si el HTML traía visible algún módulo
    setMode('landing');
  }

  /* ============================ REDES / WEB ============================ */
  var redesData = null;
  var redesLoadPromise = null;
  var redesCharts = {};

  function redesFmt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('es-ES');
  }

  function redesPalette() {
    return (typeof CHART_PALETTE !== 'undefined' && CHART_PALETTE) ||
      ['#8b5cf6', '#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
  }

  function ensureRedesLoaded(force) {
    if (redesData && !force) return Promise.resolve(redesData);
    if (redesLoadPromise && !force) return redesLoadPromise;
    var url = dataUrl('/api/redes/overview') + (force ? '?refresh=1' : '');
    redesLoadPromise = fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { redesData = d; return d; })
      .catch(function (e) { redesData = { error: e.message || String(e), config: { meta: false, ga: false } }; return redesData; })
      .finally(function () { redesLoadPromise = null; });
    return redesLoadPromise;
  }

  function redesChart(id, config) {
    var c = document.getElementById(id);
    if (!c || typeof Chart === 'undefined') return;
    if (redesCharts[id]) { redesCharts[id].destroy(); redesCharts[id] = null; }
    redesCharts[id] = new Chart(c, config);
  }

  function redesLineOpts() {
    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } };
  }

  function renderRedesStatus(d) {
    var box = document.getElementById('redes-status');
    if (!box) return;
    var cfg = (d && d.config) || { meta: false, ga: false };
    var problems = [];
    if (!cfg.meta) problems.push('Meta (Facebook/Instagram)');
    if (!cfg.ga) problems.push('Google Analytics');
    // Errores devueltos por el backend aun estando configurado
    var errs = [];
    if (d && d.meta && d.meta.error) errs.push('Meta: ' + d.meta.error);
    if (d && d.meta && d.meta.facebook && d.meta.facebook.insightsError) errs.push('Facebook insights: ' + d.meta.facebook.insightsError);
    if (d && d.meta && d.meta.instagram && d.meta.instagram.insightsError) errs.push('Instagram insights: ' + d.meta.instagram.insightsError);
    var gaErr = (d && d.ga && d.ga.error) ? String(d.ga.error) : '';
    var gaAuth = gaErr && /grant|token|auth|unauthor|401|invalid|expired|caduc/i.test(gaErr);
    if (gaErr) errs.push('Google Analytics: ' + (gaAuth ? 'sesión de Google caducada (' + gaErr + ')' : gaErr));

    if (!problems.length && !errs.length) {
      box.className = 'redes-status redes-status-ok';
      box.style.display = 'flex';
      var metaTxt = cfg.metaManual
        ? 'Google Analytics en directo · Meta (Facebook/Instagram) con datos manuales, actualización mensual.'
        : 'Mostrando datos reales de Meta y Google Analytics (últimos 30 días).';
      box.innerHTML = '<span class="redes-status-icon">✅</span><div><strong>Conexiones activas</strong>' + metaTxt + '</div>';
      return;
    }
    box.className = 'redes-status';
    box.style.display = 'flex';
    var html = '<span class="redes-status-icon">🔌</span><div>';
    if (problems.length) {
      html += '<strong>Falta configurar: ' + problems.join(' y ') + '</strong>';
      html += 'Añade las credenciales en el archivo <code>.env</code> y pulsa “Actualizar”. Ve a la pestaña <em>Conexiones</em> para ver qué necesita cada integración.';
    }
    if (errs.length) {
      html += (problems.length ? '<br>' : '<strong>Aviso de las APIs</strong>') + errs.map(function (e) { return '<div>· ' + e + '</div>'; }).join('');
    }
    if (gaAuth) {
      html += '<div style="margin-top:.65rem"><a href="/api/redes/oauth/start" target="_blank" rel="noopener" class="reload-btn" style="display:inline-block;text-decoration:none">🔄 Reconectar Google Analytics</a> <span style="color:#64748b;font-size:.85rem">— inicia sesión con tu cuenta de Google y autoriza; luego pulsa “Actualizar”.</span></div>';
    }
    html += '</div>';
    box.innerHTML = html;
  }

  function renderRedesResumen(d) {
    var meta = (d && d.meta) || {};
    var fb = meta.facebook || {};
    var ig = meta.instagram || {};
    var ga = (d && d.ga) || {};
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('redes-kpi-fb-followers', redesFmt(fb.followers != null ? fb.followers : fb.fanCount));
    set('redes-kpi-fb-name', fb.name || (d && d.config && d.config.meta ? 'Facebook' : 'No conectado'));
    set('redes-kpi-ig-followers', redesFmt(ig.followers));
    set('redes-kpi-ig-name', ig.username ? '@' + ig.username : (d && d.config && d.config.meta ? 'Instagram' : 'No conectado'));
    var byDay = ga.byDay || [];
    var gaDown = !!ga.error || (ga.sessions == null && !byDay.length);
    set('redes-kpi-ga-sessions', gaDown ? 'Sin conexión' : redesFmt(ga.sessions));
    set('redes-kpi-ga-users', ga.error ? 'Reautorizar GA' : (ga.users != null ? redesFmt(ga.users) + ' usuarios' : (d && d.config && d.config.ga ? '—' : 'No conectado')));
    var reach = (fb.reach || 0) + (ig.reach || 0);
    set('redes-kpi-reach', reach ? redesFmt(reach) : '—');

    // Sesiones web por día (oculta la tarjeta cuando GA está caído o sin datos, para no mostrar una gráfica vacía)
    toggleRedesChartCard('chart-redes-ga-dia', byDay.length > 0);
    if (byDay.length) {
      redesChart('chart-redes-ga-dia', {
        type: 'line',
        data: { labels: byDay.map(function (x) { return x.date.slice(5); }), datasets: [{ label: 'Sesiones', data: byDay.map(function (x) { return x.sessions; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.3 }] },
        options: redesLineOpts()
      });
    }
    // Alcance redes por día (FB + IG combinados por fecha)
    var map = {};
    (fb.daily || []).forEach(function (x) { if (x.date) map[x.date] = (map[x.date] || 0) + (x.reach || 0); });
    (ig.daily || []).forEach(function (x) { if (x.date) map[x.date] = (map[x.date] || 0) + (x.reach || 0); });
    var dates = Object.keys(map).sort();
    var showReachDia = (meta.source !== 'manual') && dates.length > 0;
    toggleRedesChartCard('chart-redes-reach-dia', showReachDia);
    if (showReachDia) {
      redesChart('chart-redes-reach-dia', {
        type: 'line',
        data: { labels: dates.map(function (x) { return x.slice(5); }), datasets: [{ label: 'Alcance', data: dates.map(function (x) { return map[x]; }), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.12)', fill: true, tension: 0.3 }] },
        options: redesLineOpts()
      });
    }
  }

  function miniKpi(label, value) {
    return '<div class="turismo-mini-kpi"><span class="turismo-mini-kpi-label">' + label + '</span><span class="turismo-mini-kpi-value">' + value + '</span></div>';
  }

  // Muestra/oculta la tarjeta de gráfica que contiene un canvas (para ocultar las vacías en modo manual).
  function toggleRedesChartCard(canvasId, show) {
    var c = document.getElementById(canvasId);
    var card = c && c.closest('.turismo-chart-card');
    if (card) card.style.display = show ? '' : 'none';
  }
  // Cambia la etiqueta de la cabecera de una sección a "Datos manuales" cuando aplica.
  function setRedesSectionTag(sectionId, manual) {
    var sec = document.getElementById(sectionId);
    var tag = sec && sec.querySelector('.turismo-section-tag');
    if (tag && manual) tag.textContent = 'Datos manuales · mensual';
  }

  function renderRedesFacebook(d) {
    var meta = (d && d.meta) || {};
    var fb = meta.facebook || {};
    var manual = meta.source === 'manual';
    var cont = document.getElementById('redes-mini-facebook');
    if (cont) {
      if (!(d && d.config && d.config.meta)) {
        cont.innerHTML = miniKpi('Estado', 'No conectado');
      } else {
        var c = miniKpi('Seguidores', redesFmt(fb.followers != null ? fb.followers : fb.fanCount));
        if (fb.publicaciones != null) c += miniKpi('Publicaciones', redesFmt(fb.publicaciones));
        if (fb.meGusta != null) c += miniKpi('Me gusta', redesFmt(fb.meGusta));
        if (fb.reach != null) c += miniKpi('Alcance (30 d)', redesFmt(fb.reach));
        if (fb.impressions != null) c += miniKpi('Visualizaciones (30 d)', redesFmt(fb.impressions));
        if (fb.engagement != null) c += miniKpi('Interacciones (30 d)', redesFmt(fb.engagement));
        if (fb.visitas != null) c += miniKpi('Visitas (30 d)', redesFmt(fb.visitas));
        var aud = meta.audiencia;
        if (aud) {
          if (aud.mujeres != null) c += miniKpi('Mujeres', String(aud.mujeres).replace('.', ',') + ' %');
          if (aud.hombres != null) c += miniKpi('Hombres', String(aud.hombres).replace('.', ',') + ' %');
          if (aud.edadPrincipal) c += miniKpi('Edad principal', aud.edadPrincipal);
          if (aud.topCiudad) c += miniKpi('Top ciudad', aud.topCiudad);
          if (aud.topPais) c += miniKpi('Top país', aud.topPais);
        }
        cont.innerHTML = c;
      }
    }
    setRedesSectionTag('section-redes-facebook', manual);
    var daily = fb.daily || [];
    var showCharts = !manual && daily.length > 0;
    toggleRedesChartCard('chart-redes-fb-reach', showCharts);
    toggleRedesChartCard('chart-redes-fb-eng', showCharts);
    if (showCharts) {
      redesChart('chart-redes-fb-reach', {
        type: 'line',
        data: { labels: daily.map(function (x) { return x.date.slice(5); }), datasets: [{ label: 'Alcance', data: daily.map(function (x) { return x.reach; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: true, tension: 0.3 }] },
        options: redesLineOpts()
      });
      redesChart('chart-redes-fb-eng', {
        type: 'bar',
        data: { labels: daily.map(function (x) { return x.date.slice(5); }), datasets: [{ label: 'Interacciones', data: daily.map(function (x) { return x.engagement; }), backgroundColor: '#8b5cf6', borderRadius: 4 }] },
        options: redesLineOpts()
      });
    }
  }

  function renderRedesInstagram(d) {
    var meta = (d && d.meta) || {};
    var ig = meta.instagram || {};
    var manual = meta.source === 'manual';
    var cont = document.getElementById('redes-mini-instagram');
    if (cont) {
      if (!(d && d.config && d.config.meta)) {
        cont.innerHTML = miniKpi('Estado', 'No conectado');
      } else {
        var c = miniKpi('Seguidores', redesFmt(ig.followers));
        if (ig.mediaCount != null) c += miniKpi('Publicaciones', redesFmt(ig.mediaCount));
        if (ig.reach != null) c += miniKpi('Alcance (30 d)', redesFmt(ig.reach));
        if (ig.impressions != null) c += miniKpi('Visualizaciones (30 d)', redesFmt(ig.impressions));
        if (ig.engagement != null) c += miniKpi('Interacciones (30 d)', redesFmt(ig.engagement));
        if (ig.meGustaMedio != null) c += miniKpi('Me gusta (medio/post)', redesFmt(ig.meGustaMedio));
        cont.innerHTML = c;
      }
    }
    setRedesSectionTag('section-redes-instagram', manual);
    var daily = ig.daily || [];
    var showCharts = !manual && daily.length > 0;
    toggleRedesChartCard('chart-redes-ig-reach', showCharts);
    if (showCharts) {
      redesChart('chart-redes-ig-reach', {
        type: 'line',
        data: { labels: daily.map(function (x) { return x.date.slice(5); }), datasets: [{ label: 'Alcance', data: daily.map(function (x) { return x.reach; }), borderColor: '#ec4899', backgroundColor: 'rgba(236,72,153,0.12)', fill: true, tension: 0.3 }] },
        options: redesLineOpts()
      });
    }
  }

  function renderRedesWeb(d) {
    var ga = (d && d.ga) || {};
    var byDay = ga.byDay || [];
    var gaCharts = ['chart-redes-ga-trend', 'chart-redes-ga-sources', 'chart-redes-ga-pages', 'chart-redes-ga-countries'];
    var cont = document.getElementById('redes-mini-web');
    // GA caído (sesión caducada) o sin datos: no dibujar gráficas vacías, mostrar aviso + reconectar.
    if (ga.error || (!byDay.length && (ga.sessions == null))) {
      if (cont) {
        cont.innerHTML = ga.error
          ? '<div style="padding:.4rem 0;color:#334155">⚠ Google Analytics desconectado (sesión de Google caducada). <a href="/api/redes/oauth/start" target="_blank" rel="noopener" class="reload-btn" style="display:inline-block;text-decoration:none;margin-left:.4rem">🔄 Reconectar Google Analytics</a></div>'
          : miniKpi('Estado', (d && d.config && d.config.ga) ? 'Sin datos' : 'No conectado');
      }
      gaCharts.forEach(function (id) { toggleRedesChartCard(id, false); });
      return;
    }
    gaCharts.forEach(function (id) { toggleRedesChartCard(id, true); });
    if (cont) {
      var dur = ga.avgDuration ? Math.round(ga.avgDuration) + ' s' : '—';
      var bounce = ga.bounceRate != null ? (ga.bounceRate * 100).toFixed(1) + ' %' : '—';
      cont.innerHTML = miniKpi('Sesiones', redesFmt(ga.sessions)) +
        miniKpi('Usuarios', redesFmt(ga.users)) +
        miniKpi('Páginas vistas', redesFmt(ga.pageviews)) +
        miniKpi('Duración media', dur) +
        miniKpi('% rebote', bounce);
    }
    redesChart('chart-redes-ga-trend', {
      type: 'line',
      data: { labels: byDay.map(function (x) { return x.date.slice(5); }), datasets: [
        { label: 'Sesiones', data: byDay.map(function (x) { return x.sessions; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.10)', fill: true, tension: 0.3 },
        { label: 'Usuarios', data: byDay.map(function (x) { return x.users; }), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.10)', fill: true, tension: 0.3 }
      ] },
      options: redesLineOpts()
    });
    var sources = ga.sources || [];
    redesChart('chart-redes-ga-sources', {
      type: 'doughnut',
      data: { labels: sources.map(function (x) { return x.source; }), datasets: [{ data: sources.map(function (x) { return x.sessions; }), backgroundColor: redesPalette() }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
    var pages = ga.topPages || [];
    redesChart('chart-redes-ga-pages', {
      type: 'bar',
      data: { labels: pages.map(function (x) { return x.path.length > 28 ? x.path.slice(0, 25) + '…' : x.path; }), datasets: [{ label: 'Páginas vistas', data: pages.map(function (x) { return x.views; }), backgroundColor: '#8b5cf6', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
    var countries = ga.countries || [];
    redesChart('chart-redes-ga-countries', {
      type: 'bar',
      data: { labels: countries.map(function (x) { return x.country; }), datasets: [{ label: 'Sesiones', data: countries.map(function (x) { return x.sessions; }), backgroundColor: '#06b6d4', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
  }

  function renderRedesConexiones(d) {
    var cont = document.getElementById('redes-conexiones');
    if (!cont) return;
    var cfg = (d && d.config) || { meta: false, ga: false };
    var card = function (name, on, detail) {
      return '<div class="redes-conn-card"><span class="redes-conn-dot ' + (on ? 'on' : 'off') + '"></span>' +
        '<div><strong>' + name + '</strong><div class="redes-conn-state">' + (on ? 'Conectado · ' + detail : 'Sin configurar') + '</div></div></div>';
    };
    var meta = (d && d.meta) || {};
    var ga = (d && d.ga) || {};
    var fbName = (meta.facebook && meta.facebook.name) || '';
    var igName = (meta.instagram && meta.instagram.username) ? '@' + meta.instagram.username : '';
    var metaDetail = [fbName, igName].filter(Boolean).join(' · ') || 'sin nombre';
    var reconectar = ga.error ? '<div style="margin-top:.5rem"><a href="/api/redes/oauth/start" target="_blank" rel="noopener" class="reload-btn" style="display:inline-block;text-decoration:none">🔄 Reconectar Google Analytics</a></div>' : '';
    cont.innerHTML = card('Meta (Facebook + Instagram)', cfg.meta && !meta.error, metaDetail) +
      card('Google Analytics 4', cfg.ga && !ga.error, ga.propertyId ? 'propiedad ' + ga.propertyId : '') + reconectar;
  }

  // Dibuja las 4 gráficas de audiencia para una plataforma ('fb' o 'ig').
  function drawAudienciaCharts(aud, p) {
    var id = function (s) { return 'chart-redes-' + p + '-' + s; };
    var hbarOpts = { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(226,232,240,0.7)' } }, y: { ticks: { color: '#0f172a' }, grid: { display: false } } } };
    // Edad y sexo
    if (aud && aud.edadSexo && aud.edadSexo.length) {
      toggleRedesChartCard(id('edadsexo'), true);
      redesChart(id('edadsexo'), {
        type: 'bar',
        data: { labels: aud.edadSexo.map(function (x) { return x.rango; }), datasets: [
          { label: 'Mujeres', data: aud.edadSexo.map(function (x) { return x.mujeres; }), backgroundColor: '#ec4899', borderRadius: 4 },
          { label: 'Hombres', data: aud.edadSexo.map(function (x) { return x.hombres; }), backgroundColor: '#2563eb', borderRadius: 4 }
        ] },
        options: redesLineOpts()
      });
    } else { toggleRedesChartCard(id('edadsexo'), false); }
    // Reparto por sexo
    if (aud && aud.mujeres != null) {
      toggleRedesChartCard(id('sexo'), true);
      redesChart(id('sexo'), {
        type: 'doughnut',
        data: { labels: ['Mujeres', 'Hombres'], datasets: [{ data: [aud.mujeres, aud.hombres], backgroundColor: ['#ec4899', '#2563eb'], borderColor: '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#0f172a' } } } }
      });
    } else { toggleRedesChartCard(id('sexo'), false); }
    // Top países
    if (aud && aud.paises && aud.paises.length) {
      toggleRedesChartCard(id('paises'), true);
      redesChart(id('paises'), {
        type: 'bar',
        data: { labels: aud.paises.map(function (x) { return x.nombre; }), datasets: [{ label: '% seguidores', data: aud.paises.map(function (x) { return x.pct; }), backgroundColor: '#14b8a6', borderRadius: 4 }] },
        options: hbarOpts
      });
    } else { toggleRedesChartCard(id('paises'), false); }
    // Top ciudades
    if (aud && aud.ciudades && aud.ciudades.length) {
      toggleRedesChartCard(id('ciudades'), true);
      redesChart(id('ciudades'), {
        type: 'bar',
        data: { labels: aud.ciudades.map(function (x) { return x.nombre; }), datasets: [{ label: '% seguidores', data: aud.ciudades.map(function (x) { return x.pct; }), backgroundColor: '#f59e0b', borderRadius: 4 }] },
        options: hbarOpts
      });
    } else { toggleRedesChartCard(id('ciudades'), false); }
  }

  function renderRedesAudiencia(d) {
    var m = (d && d.meta) || {};
    drawAudienciaCharts(m.audiencia || null, 'fb');
    drawAudienciaCharts(m.audienciaInstagram || null, 'ig');
  }

  function renderRedesHistorico(d) {
    var hist = (d && d.meta && d.meta.historico) || [];
    var hint = document.getElementById('redes-historico-hint');
    if (hint) {
      hint.textContent = (d && d.meta && d.meta.source === 'manual')
        ? 'Histórico manual — se añade un punto cada mes (actualización el día 1).'
        : 'Seguidores por mes.';
    }
    hist = hist.slice().sort(function (a, b) { return String(a.mes).localeCompare(String(b.mes)); });
    var labels = hist.map(function (x) { return x.mes; });
    redesChart('chart-redes-historico', {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Facebook', data: hist.map(function (x) { return x.fbSeguidores != null ? x.fbSeguidores : null; }), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.12)', fill: false, tension: 0.3, spanGaps: true },
          { label: 'Instagram', data: hist.map(function (x) { return x.igSeguidores != null ? x.igSeguidores : null; }), borderColor: '#d6249f', backgroundColor: 'rgba(214,36,159,0.12)', fill: false, tension: 0.3, spanGaps: true }
        ]
      },
      options: redesLineOpts()
    });
  }

  function renderRedesAll() {
    var d = redesData || { config: { meta: false, ga: false } };
    var upd = document.getElementById('redes-hero-update');
    if (upd) upd.textContent = d.generatedAt ? new Date(d.generatedAt).toLocaleString('es-ES') : '—';
    renderRedesStatus(d);
    renderRedesResumen(d);
    renderRedesHistorico(d);
    renderRedesFacebook(d);
    renderRedesAudiencia(d);
    renderRedesInstagram(d);
    renderRedesWeb(d);
    renderRedesConexiones(d);
  }

  function initRedes() {
    wireModeButtons();
    document.querySelectorAll('#nav-redes .nav-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#nav-redes .nav-item').forEach(function (n) { n.classList.remove('active'); });
        el.classList.add('active');
        document.querySelectorAll('#main-redes .section').forEach(function (s) { s.classList.remove('active'); });
        var sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
        var header = document.getElementById('header-redes');
        if (header) {
          var titles = {
            'redes-resumen': 'Redes / Web - Resumen',
            'redes-facebook': 'Redes / Web - Facebook',
            'redes-instagram': 'Redes / Web - Instagram',
            'redes-web': 'Redes / Web - Web (Google Analytics)',
            'redes-fuentes': 'Redes / Web - Conexiones'
          };
          var h2 = header.querySelector('h2');
          if (h2 && titles[el.dataset.section]) h2.textContent = titles[el.dataset.section];
        }
        setTimeout(function () { renderRedesAll(); }, 60);
      });
    });
    var btn = document.getElementById('redes-refresh');
    if (btn) btn.addEventListener('click', function () {
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = 'Actualizando…';
      ensureRedesLoaded(true).then(function () { renderRedesAll(); })
        .finally(function () { btn.disabled = false; btn.textContent = orig; });
    });
  }

  function init() {
    initLanding();
    initCamaras();
    initResiduos();
    initTurismo();
    initRedes();
    loadCamarasData();
    document.querySelectorAll('#nav-camaras .nav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#nav-camaras .nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#main-camaras .section').forEach((s) => s.classList.remove('active'));
        const sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
        var sname = el.dataset.section;
        var lprSecs = ['camaras-resumen', 'camaras-evolucion', 'camaras-horario', 'camaras-procedencia', 'camaras-colores'];
        var fb = document.getElementById('lpr-filtros');
        if (fb) fb.style.display = (lprSecs.indexOf(sname) >= 0) ? '' : 'none';
        var dirWrap = document.getElementById('lpr-f-dir-wrap');
        var camWrap = document.getElementById('lpr-f-cam-wrap');
        var showDir = ['camaras-resumen', 'camaras-evolucion', 'camaras-horario'].indexOf(sname) >= 0;
        var showCam = ['camaras-evolucion', 'camaras-horario'].indexOf(sname) >= 0;
        if (dirWrap) dirWrap.style.display = showDir ? '' : 'none';
        if (camWrap) camWrap.style.display = showCam ? '' : 'none';
        // Barra de filtros de aforo (multiobjeto)
        var multiSecs = ['camaras-multiobjeto', 'camaras-multiobjeto-calles', 'camaras-multiobjeto-detalle'];
        var mfb = document.getElementById('multi-filtros');
        if (mfb) mfb.style.display = (multiSecs.indexOf(sname) >= 0) ? '' : 'none';
        var mCamWrap = document.getElementById('multi-f-cam-wrap');
        if (mCamWrap) {
          // En "Por cámara" se usa el selector propio: ocultamos (y reseteamos) el filtro global de cámara.
          if (sname === 'camaras-multiobjeto-detalle') { mCamWrap.style.display = 'none'; var mc = document.getElementById('multi-f-cam'); if (mc) mc.value = ''; }
          else mCamWrap.style.display = '';
        }
        if (sname === 'camaras-resumen') {
          setTimeout(function () { renderLprResumen(); if (mapaLpr) mapaLpr.invalidateSize(true); }, 180);
        }
        if (sname === 'camaras-evolucion') { setTimeout(renderLprEvolucion, 60); }
        if (sname === 'camaras-horario') { setTimeout(renderLprHorario, 60); }
        if (sname === 'camaras-procedencia') { setTimeout(renderLprProcedencia, 60); }
        if (sname === 'camaras-colores') { setTimeout(renderLprColores, 60); }
        if (sname === 'camaras-multiobjeto') {
          setTimeout(function () { renderCamarasMultiobjeto(); if (mapaMultiobjeto) mapaMultiobjeto.invalidateSize(true); }, 180);
        }
        if (sname === 'camaras-multiobjeto-calles') {
          setTimeout(renderMultiCalles, 60);
        }
        if (sname === 'camaras-multiobjeto-detalle') {
          setTimeout(function () { initMultiSelect(); renderMultiDetalle(); }, 60);
        }
        if (sname === 'camaras-informes') { setTimeout(function () { initInformesSection('camaras'); }, 60); }
        if (sname === 'camaras-sit') { setTimeout(function () { initSitCamaras(); }, 60); }
        const header = document.getElementById('header-camaras');
        if (header) {
          const titles = { 'camaras-resumen': 'Accesos — mapa de tráfico (LPR)', 'camaras-evolucion': 'Evolución del tráfico (LPR)', 'camaras-horario': 'Perfil horario (LPR)', 'camaras-procedencia': 'Procedencia de los vehículos (LPR)', 'camaras-colores': 'Vehículos por color (LPR)', 'camaras-multiobjeto': 'Afluencia — mapa de calles', 'camaras-multiobjeto-calles': 'Calles más concurridas', 'camaras-multiobjeto-detalle': 'Aforo por cámara', 'camaras-informes': 'Cámaras — Informes', 'camaras-sit': 'Informe SIT — cámaras por horas' };
          const h2 = header.querySelector('h2');
          if (h2 && titles[el.dataset.section]) h2.textContent = titles[el.dataset.section];
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
