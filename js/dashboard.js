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
  let chartCamarasColorDona = null;
  let mapaCamaras = null;
  let mapaResiduos = null;
  let mapaZonas = null;
  let mapaResiduosSampleCache = null;
  let zonasGeojsonCache = null;
  let useResumen = false;

  const ZONA_MAP_COLORS = ['#00c9a7', '#7c3aed', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#10b981', '#6366f1', '#14b8a6', '#a855f7'];

  function addDashboardBasemap(map) {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);
  }

  const MAP_POINT_STYLE = {
    radius: 9,
    weight: 2,
    color: '#1d4ed8',
    fillColor: '#2563eb',
    fillOpacity: 0.92
  };

  /** Contenedores/recogidas del servicio están en Peñíscola: acotamos al término (~bbox OSM) y descartamos GPS fuera. */
  const PENISCOLA_CENTER = [40.358, 0.406];
  const PENISCOLA_MAX_BOUNDS = L.latLngBounds([40.325, 0.368], [40.428, 0.462]);

  function coordsEnTerminoPeniscola(lat, lng) {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
    return PENISCOLA_MAX_BOUNDS.contains(L.latLng(lat, lng));
  }

  function mapOptionsPeniscola() {
    return {
      preferCanvas: false,
      maxBounds: PENISCOLA_MAX_BOUNDS,
      maxBoundsViscosity: 0.85,
      minZoom: 12
    };
  }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b949e' } } },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
      }
    };
    const canvasMes = document.getElementById('chart-camaras-mes');
    const canvasDia = document.getElementById('chart-camaras-dia');
    if (chartCamarasMes) { chartCamarasMes.destroy(); chartCamarasMes = null; }
    if (chartCamarasDia) { chartCamarasDia.destroy(); chartCamarasDia = null; }
    if (canvasMes && monthKeys.length > 0) {
      chartCamarasMes = new Chart(canvasMes, { type: 'bar', data: { labels: monthKeys.map((k) => MESES[parseInt(k.split('-')[1], 10) - 1] || k), datasets: [{ label: 'Entradas (Avance)', data: monthKeys.map((k) => (monthsFiltered[k] && monthsFiltered[k].Avance) || 0), backgroundColor: '#3b82f6' }, { label: 'Salidas (Retroceso)', data: monthKeys.map((k) => (monthsFiltered[k] && monthsFiltered[k].Retroceso) || 0), backgroundColor: '#1e40af' }] }, options: opts });
    }
    const dayKeys = Object.keys(daysFiltered).sort();
    if (canvasDia && dayKeys.length > 0) {
      chartCamarasDia = new Chart(canvasDia, { type: 'line', data: { labels: dayKeys.map((k) => k.slice(5)), datasets: [{ label: 'Entradas (Avance)', data: dayKeys.map((k) => (daysFiltered[k] && daysFiltered[k].Avance) || 0), borderColor: '#3b82f6', fill: false }, { label: 'Salidas (Retroceso)', data: dayKeys.map((k) => (daysFiltered[k] && daysFiltered[k].Retroceso) || 0), borderColor: '#1e40af', fill: false }] }, options: opts });
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
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b949e' } } },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
      }
    };
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
              { label: 'Entradas', data: horaData.map((d) => d.avance), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.2)', fill: true },
              { label: 'Salidas', data: horaData.map((d) => d.retroceso), borderColor: '#1e40af', backgroundColor: 'rgba(30,64,175,0.2)', fill: true }
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
              { label: 'Entradas', data: diaAvance, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.2)', fill: true },
              { label: 'Salidas', data: diaRetroceso, borderColor: '#1e40af', backgroundColor: 'rgba(30,64,175,0.2)', fill: true }
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
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b949e' } } },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
      }
    };
    const COLORS = ['#00c9a7', '#7c3aed', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#10b981', '#6366f1', '#14b8a6', '#a855f7'];
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
    if (cCamara && camaraEntries.length) chartCamarasPorCamara = new Chart(cCamara, { type: 'bar', data: { labels: camaraEntries.map(([k]) => k.length > 25 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'Tráfico', data: camaraEntries.map(([, v]) => v), backgroundColor: '#3b82f6' }] }, options: opts });
    if (cNac && nacEntries.length) chartCamarasNacionalidad = new Chart(cNac, { type: 'bar', data: { labels: nacEntries.map(([k]) => k), datasets: [{ label: 'Vehículos', data: nacEntries.map(([, v]) => v), backgroundColor: COLORS[0] }] }, options: opts });
    if (cNacDona && nacEntries.length) chartCamarasNacionalidadDona = new Chart(cNacDona, { type: 'doughnut', data: { labels: nacEntries.map(([k]) => k), datasets: [{ data: nacEntries.map(([, v]) => v), backgroundColor: COLORS }] }, options: Object.assign({}, opts, { cutout: '60%' }) });
    if (cColor && colorEntries.length) chartCamarasColor = new Chart(cColor, { type: 'bar', data: { labels: colorEntries.map(([k]) => k), datasets: [{ label: 'Vehículos', data: colorEntries.map(([, v]) => v), backgroundColor: COLORS }] }, options: opts });
    if (cColorDona && colorEntries.length) chartCamarasColorDona = new Chart(cColorDona, { type: 'doughnut', data: { labels: colorEntries.map(([k]) => k), datasets: [{ data: colorEntries.map(([, v]) => v), backgroundColor: COLORS }] }, options: Object.assign({}, opts, { cutout: '60%' }) });
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
      container.innerHTML = '<p style="padding:2rem;color:var(--text-muted)">No hay coordenadas. Ejecuta <code>npm run preparar</code> para generar datos.</p>';
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
    } catch (e) { container.innerHTML = '<p style="padding:2rem;color:#ef4444">Error al cargar el mapa: ' + (e.message || e) + '</p>'; }
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
    const headerResiduos = document.getElementById('header-residuos');
    const headerCamaras = document.getElementById('header-camaras');
    const navResiduos = document.getElementById('nav-residuos');
    const navCamaras = document.getElementById('nav-camaras');
    const toggle = document.getElementById('mode-toggle');
    const footer = document.getElementById('sidebar-footer');
    if (mode === 'residuos') {
      if (mainResiduos) mainResiduos.style.display = 'block';
      if (mainCamaras) mainCamaras.style.display = 'none';
      if (headerResiduos) headerResiduos.style.display = 'flex';
      if (headerCamaras) headerCamaras.style.display = 'none';
      if (navResiduos) navResiduos.style.display = 'block';
      if (navCamaras) navCamaras.style.display = 'none';
      if (toggle) toggle.textContent = 'Ir a Cámaras';
      if (footer) footer.textContent = 'Residuos municipales';
      // Chart.js necesita el panel visible; un tick después del layout
      setTimeout(function () { updateResiduosKPIs(); syncResiduosMapIfNeeded(); }, 50);
    } else {
      if (mainResiduos) mainResiduos.style.display = 'none';
      if (mainCamaras) mainCamaras.style.display = 'block';
      if (headerResiduos) headerResiduos.style.display = 'none';
      if (headerCamaras) headerCamaras.style.display = 'flex';
      if (navResiduos) navResiduos.style.display = 'none';
      if (navCamaras) navCamaras.style.display = 'block';
      if (toggle) toggle.textContent = 'Ir a Residuos';
      if (footer) footer.textContent = 'Cámaras de tráfico';
      setTimeout(function () { invalidateMapaCamaras(); }, 120);
    }
  }

  function loadAllData() {
    return fetch('/data/RESIDUOS/resumen.json').then((r) => { if (r.ok) return r.json().then((d) => ({ useResumen: true, data: d })); throw new Error('No resumen'); }).then((result) => {
      useResumen = result.useResumen;
      if (result.useResumen && result.data) {
        dataPesajes = (result.data.pesajes || []).map((x) => ({ fecha: x.fecha, kg: x.kg }));
        dataCamion = (result.data.camion || []).map((x) => ({ fecha: x.fecha, kg: x.kg, weight: x.kg, salidas: x.salidas, zonas: x.zonas, tipos: x.tipos, hoteles: x.hoteles }));
        return { pesajes: dataPesajes, camion: dataCamion };
      }
      throw new Error('Sin datos');
    }).catch(() => Promise.all([fetch('/data/RESIDUOS/pesajes/todos.json').then((r) => r.ok ? r.json() : []).catch(() => []), fetch('/data/RESIDUOS/camion/todos.json').then((r) => r.ok ? r.json() : []).catch(() => [])]).then(([pesajes, camion]) => {
      useResumen = false;
      dataPesajes = Array.isArray(pesajes) ? pesajes : [];
      dataCamion = Array.isArray(camion) ? camion : [];
      return { pesajes: dataPesajes, camion: dataCamion };
    }));
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

  function getResiduosYears() {
    const set = new Set();
    dataPesajes.forEach((r) => { const mes = mesDesdeFecha(r.fecha); if (mes) set.add(mes.slice(0, 4)); });
    dataCamion.forEach((r) => { const mes = mesDesdeFecha(r.fecha); if (mes) set.add(mes.slice(0, 4)); });
    return Array.from(set).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  function getResiduosMonths(year) {
    const set = new Set();
    const encaja = (mes) => {
      if (!mes) return false;
      if (!year) return true;
      return mes.slice(0, 4) === year;
    };
    dataPesajes.forEach((r) => { const mes = mesDesdeFecha(r.fecha); if (encaja(mes)) set.add(mes); });
    dataCamion.forEach((r) => { const mes = mesDesdeFecha(r.fecha); if (encaja(mes)) set.add(mes); });
    return Array.from(set).sort();
  }

  function filterMapaResiduosSample(points, year, mes) {
    if (!Array.isArray(points)) return [];
    return points.filter((p) => matchesPeriodo(p.fecha || '', year || '', mes || ''));
  }

  /** Coordenadas para el mapa: prioriza mapa_sample.json (ligero); si no existe, mapa.json. */
  function ensureMapaResiduosSample() {
    if (mapaResiduosSampleCache) return Promise.resolve(mapaResiduosSampleCache);
    return fetch('/data/RESIDUOS/camion/mapa_sample.json')
      .then((r) => {
        if (r.ok) return r.json();
        return fetch('/data/RESIDUOS/camion/mapa.json').then((r2) => {
          if (!r2.ok) throw new Error('mapa');
          return r2.json();
        });
      })
      .then((data) => {
        mapaResiduosSampleCache = Array.isArray(data) ? data : [];
        return mapaResiduosSampleCache;
      });
  }

  function camionRowsForMap(year, mes) {
    const rows = [];
    dataCamion.forEach((r) => {
      if (!matchesPeriodo(r.fecha, year, mes)) return;
      const la = r.lat != null ? Number(r.lat) : null;
      const ln = r.lng != null ? Number(r.lng) : (r.lon != null ? Number(r.lon) : null);
      if (la == null || ln == null || isNaN(la) || isNaN(ln)) return;
      if (!coordsEnTerminoPeniscola(la, ln)) return;
      rows.push(r);
    });
    return rows;
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

  function colorChoroplethKgZonas(kg, maxKg) {
    if (kg <= 0) return '#cbd5e1';
    const t = Math.min(1, kg / Math.max(maxKg, 1e-9));
    const h = 205 - Math.round(t * 50);
    const s = 55 + Math.round(t * 25);
    const l = 58 - Math.round(t * 18);
    return 'hsl(' + h + ' ' + s + '% ' + l + '%)';
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
    if (!container || typeof L === 'undefined' || typeof L.markerClusterGroup !== 'function') return;
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const year = (yearSelect && yearSelect.value) || '';
    const mes = (mesSelect && mesSelect.value) || '';
    if (mapaResiduos) { mapaResiduos.remove(); mapaResiduos = null; }
    container.innerHTML = '';
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtKg = (n) => (n != null ? n : 0).toLocaleString('es-ES');

    const addMarkersFromRecords = (records, fromSample) => {
      const cluster = L.markerClusterGroup({
        maxClusterRadius: 32,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        chunkedLoading: true,
        chunkInterval: 120,
        chunkDelay: 25,
        iconCreateFunction: function (c) {
          const n = c.getChildCount();
          let size = n < 10 ? 36 : n < 100 ? 44 : 52;
          return L.divIcon({
            html: '<div class="residuos-cluster-inner"><span>' + n + '</span></div>',
            className: 'residuos-cluster-icon',
            iconSize: L.point(size, size)
          });
        }
      });
      const latlngs = [];
      records.forEach((r) => {
        const la = fromSample ? Number(r.lat) : (r.lat != null ? Number(r.lat) : null);
        const ln = fromSample ? Number(r.lng) : (r.lng != null ? Number(r.lng) : (r.lon != null ? Number(r.lon) : null));
        if (la == null || ln == null || isNaN(la) || isNaN(ln)) return;
        if (!coordsEnTerminoPeniscola(la, ln)) return;
        latlngs.push([la, ln]);
        const kg = fromSample ? toNum(r.weight) : toNum(r.weight != null ? r.weight : r.kg);
        const zona = fromSample ? (r.zona || '') : (r.zona || '');
        const fecha = fromSample ? (r.fecha_dia || r.fecha || '') : (r.fecha || '');
        const mk = L.circleMarker([la, ln], MAP_POINT_STYLE);
        mk.bindPopup('<strong>' + esc(zona) + '</strong><br>' + esc(fecha) + '<br>' + fmtKg(kg) + ' kg');
        cluster.addLayer(mk);
      });
      mapaResiduos = L.map('mapa-residuos', Object.assign({}, mapOptionsPeniscola()));
      mapaResiduos.setView(PENISCOLA_CENTER, 14);
      addDashboardBasemap(mapaResiduos);
      mapaResiduos.addLayer(cluster);
      if (latlngs.length) {
        mapaResiduos.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 16, animate: false });
      }
      mapaResiduos.whenReady(() => {
        setTimeout(() => { if (mapaResiduos) mapaResiduos.invalidateSize(true); }, 0);
        setTimeout(() => { if (mapaResiduos) mapaResiduos.invalidateSize(true); }, 280);
      });
    };

    if (!useResumen) {
      const rows = camionRowsForMap(year, mes);
      if (rows.length > 0) {
        addMarkersFromRecords(rows, false);
        return;
      }
      ensureMapaResiduosSample()
        .then((all) => {
          const fallback = filterMapaResiduosSample(all, year, mes);
          addMarkersFromRecords(fallback, true);
        })
        .catch(fallbackEmptyMap);
      return;
    }

    ensureMapaResiduosSample()
      .then((all) => {
        const rows = filterMapaResiduosSample(all, year, mes);
        addMarkersFromRecords(rows, true);
      })
      .catch(fallbackEmptyMap);

    function fallbackEmptyMap() {
      mapaResiduos = L.map('mapa-residuos', Object.assign({}, mapOptionsPeniscola()));
      mapaResiduos.setView(PENISCOLA_CENTER, 14);
      addDashboardBasemap(mapaResiduos);
      mapaResiduos.whenReady(() => {
        setTimeout(() => { if (mapaResiduos) mapaResiduos.invalidateSize(true); }, 200);
      });
    }
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
    addDashboardBasemap(mapaZonas);

    const kgMap = buildKgPorZona(year, mes);
    const vals = Object.keys(kgMap).length ? Object.values(kgMap).map(toNum) : [];
    let maxKg = 1;
    if (vals.length) {
      const mx = Math.max.apply(null, vals);
      maxKg = mx > 0 ? mx : 1;
    }

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
      const m = rows.length ? Math.max.apply(null, rows.map((r) => r.kg)) : 1;
      const ll = [];
      rows.forEach((row, i) => {
        const radius = 10 + Math.sqrt(row.kg / m) * 20;
        const color = ZONA_MAP_COLORS[i % ZONA_MAP_COLORS.length];
        const circle = L.circleMarker([row.lat, row.lng], {
          radius,
          weight: 3,
          color: '#1f2937',
          fillColor: color,
          fillOpacity: 0.72
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
      : fetch('/data/zonas_peniscola.geojson').then((r) => {
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
            const kg = kgParaZonaEnPoligono(kgMap, name);
            return {
              fillColor: colorChoroplethKgZonas(kg, maxKg),
              fillOpacity: 0.52,
              color: '#334155',
              weight: 2
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
    const COLORS = ['#00c9a7', '#7c3aed', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#10b981', '#6366f1'];
    const doughnutPalette = (n) => {
      if (n <= COLORS.length) return COLORS.slice(0, n);
      const out = [];
      for (let i = 0; i < n; i++) out.push(`hsl(${Math.round((360 * i) / Math.max(n, 1))} 48% 50%)`);
      return out;
    };
    const barPalette = (n) => {
      if (n <= COLORS.length) return COLORS.slice(0, n);
      return doughnutPalette(n);
    };
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b949e' }, position: 'bottom' } },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
      }
    };
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
    const doughnutOpts = Object.assign({}, opts, { cutout: '60%' });
    const barOptsHoteles = Object.assign({}, opts, { scales: { x: { ticks: { maxRotation: 45, minRotation: 0, color: '#8b949e' }, grid: { color: '#30363d' } }, y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } } } });
    if (cZ && zonasEntries.length) chartZonas = new Chart(cZ, { type: 'doughnut', data: { labels: zonasEntries.map(([k]) => k), datasets: [{ data: zonasEntries.map(([, v]) => v), backgroundColor: doughnutPalette(zonasEntries.length) }] }, options: doughnutOpts });
    if (cT && tiposEntries.length) chartTipos = new Chart(cT, { type: 'doughnut', data: { labels: tiposEntries.map(([k]) => k), datasets: [{ data: tiposEntries.map(([, v]) => v), backgroundColor: doughnutPalette(tiposEntries.length) }] }, options: doughnutOpts });
    if (cH && hotelesEntries.length) chartHoteles = new Chart(cH, { type: 'bar', data: { labels: hotelesEntries.map(([k]) => k.length > 22 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'kg', data: hotelesEntries.map(([, v]) => v), backgroundColor: barPalette(hotelesEntries.length) }] }, options: barOptsHoteles });
    const cZTab = document.getElementById('chart-residuos-zonas-tab');
    const cTTab = document.getElementById('chart-residuos-tipos-tab');
    const cHTab = document.getElementById('chart-residuos-hoteles-tab');
    if (cZTab && zonasEntries.length) chartResiduosZonasTab = new Chart(cZTab, { type: 'doughnut', data: { labels: zonasEntries.map(([k]) => k), datasets: [{ data: zonasEntries.map(([, v]) => v), backgroundColor: doughnutPalette(zonasEntries.length) }] }, options: doughnutOpts });
    if (cTTab && tiposEntries.length) chartResiduosTiposTab = new Chart(cTTab, { type: 'doughnut', data: { labels: tiposEntries.map(([k]) => k), datasets: [{ data: tiposEntries.map(([, v]) => v), backgroundColor: doughnutPalette(tiposEntries.length) }] }, options: doughnutOpts });
    if (cHTab && hotelesEntries.length) chartResiduosHotelesTab = new Chart(cHTab, { type: 'bar', data: { labels: hotelesEntries.map(([k]) => k.length > 22 ? k.slice(0, 22) + '…' : k), datasets: [{ label: 'kg', data: hotelesEntries.map(([, v]) => v), backgroundColor: barPalette(hotelesEntries.length) }] }, options: barOptsHoteles });
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
    var zonaEl = document.getElementById('tabla-completa-zonas');
    var tipoEl = document.getElementById('tabla-completa-tipos');
    var hotelEl = document.getElementById('tabla-completa-hoteles');
    if (zonaEl) renderTable(zonasEntries || [], 'tabla-completa-zonas');
    if (tipoEl) renderTable(tiposEntries || [], 'tabla-completa-tipos');
    if (hotelEl) renderTable(hotelesEntries || [], 'tabla-completa-hoteles');
  }

  window.toggleDashboardMode = function () {
    setMode(mode === 'camaras' ? 'residuos' : 'camaras');
  };

  function initResiduos() {
    const yearSelect = document.getElementById('residuos-year');
    const mesSelect = document.getElementById('residuos-mes');
    const reloadBtn = document.getElementById('residuos-reload');
    const toggle = document.getElementById('mode-toggle');
    if (toggle) {
      toggle.onclick = function (e) { e.preventDefault(); e.stopPropagation(); window.toggleDashboardMode(); };
    }
    loadAllData().then(() => {
      const years = getResiduosYears();
      if (yearSelect) { yearSelect.innerHTML = ''; years.forEach((y) => yearSelect.appendChild(new Option(y, y))); if (years.length) yearSelect.value = years[years.length - 1]; }
      if (mesSelect) {
        mesSelect.innerHTML = '';
        mesSelect.appendChild(new Option('Todo el año', ''));
        const y = (yearSelect && yearSelect.value) || '';
        const months = getResiduosMonths(y);
        months.forEach((m) => { const mm = m.split('-')[1]; mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m)); });
        if (months.length) mesSelect.value = months[months.length - 1];
      }
      if (yearSelect) yearSelect.addEventListener('change', () => { const y = yearSelect.value; mesSelect.innerHTML = ''; mesSelect.appendChild(new Option('Todo el año', '')); const months = getResiduosMonths(y); months.forEach((m) => { const mm = m.split('-')[1]; mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m)); }); if (months.length) mesSelect.value = months[months.length - 1]; updateResiduosKPIs(); });
      if (mesSelect) mesSelect.addEventListener('change', updateResiduosKPIs);
      const cmp = document.getElementById('residuos-compare');
      if (cmp) cmp.addEventListener('change', updateResiduosKPIs);
      if (residuosMainVisible()) updateResiduosKPIs();
    }).catch(() => { if (yearSelect) yearSelect.innerHTML = '<option value="">Sin datos</option>'; if (mesSelect) mesSelect.innerHTML = '<option value="">Sin datos</option>'; });
    if (reloadBtn) reloadBtn.addEventListener('click', () => loadAllData().then(() => {
      mapaResiduosSampleCache = null;
      zonasGeojsonCache = null;
      const years = getResiduosYears();
      if (yearSelect && years.length) { yearSelect.innerHTML = ''; years.forEach((y) => yearSelect.appendChild(new Option(y, y))); yearSelect.value = years[years.length - 1]; }
      if (mesSelect && yearSelect) { const y = yearSelect.value; mesSelect.innerHTML = ''; mesSelect.appendChild(new Option('Todo el año', '')); const months = getResiduosMonths(y); months.forEach((m) => { const mm = m.split('-')[1]; mesSelect.appendChild(new Option(MESES[parseInt(mm, 10) - 1] || m, m)); }); if (months.length) mesSelect.value = months[months.length - 1]; }
      updateResiduosKPIs();
    }));
    document.querySelectorAll('#nav-residuos .nav-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#nav-residuos .nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.querySelectorAll('#main-residuos .section').forEach((s) => s.classList.remove('active'));
        const sec = document.getElementById('section-' + el.dataset.section);
        if (sec) sec.classList.add('active');
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

  function init() {
    initCamaras();
    initResiduos();
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
