/**
 * Repositorio (datos brutos): visor de ficheros de origen (LPR, aforo, pesajes).
 * Selector de fichero + filtros (cámara, sentido, país, tipo, marca, color, día /
 * mes, día) + tabla con el contenido. Solo lectura.
 */
(function () {
  'use strict';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function relDe(f) { return f.carpeta ? f.carpeta + '/' + f.nombre : f.nombre; }
  function mesLbl(ym) { var p = String(ym).split('-'); if (p.length < 2) return ym; return (MESES[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0]; }

  var repoFileActual = {}; // pref -> rel (para reconstruir la barra de filtros al cambiar de fichero)

  function renderTabla(prevEl, j) {
    var conHeader = j.header && j.header.length;
    var header = conHeader ? j.header : ((j.filas && j.filas[0]) || []);
    var filas = conHeader ? (j.filas || []) : (j.filas || []).slice(1);
    filas = filas.filter(function (f) { return f && f.some(function (c) { return String(c).trim() !== ''; }); });
    if (!filas.length && !header.length) { prevEl.innerHTML = '<div style="padding:.8rem;color:#94a3b8;font-size:.85rem">Sin resultados para el filtro.</div>'; return; }
    var nCols = Math.max(header.length, filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0));
    var th = '<tr>' + Array.from({ length: nCols }).map(function (_, i) { return '<th style="position:sticky;top:0;background:#1e293b;color:#fff;padding:.4rem .55rem;text-align:left;font-weight:600;white-space:nowrap;font-size:.8rem">' + esc(header[i] || '') + '</th>'; }).join('') + '</tr>';
    var tb = filas.map(function (fila, ri) { return '<tr style="background:' + (ri % 2 ? '#f8fafc' : '#fff') + '">' + Array.from({ length: nCols }).map(function (_, i) { return '<td style="padding:.35rem .55rem;border-bottom:1px solid #f1f5f9;white-space:nowrap;color:#334155">' + esc(fila[i] || '') + '</td>'; }).join('') + '</tr>'; }).join('');
    var nota = filas.length + ' filas' + (j.truncado ? ' · tope alcanzado, afina con los filtros' : '');
    prevEl.innerHTML = '<div style="max-height:64vh;overflow:auto;border:1px solid #e2e8f0;border-radius:8px"><table style="border-collapse:collapse;font-size:.85rem;min-width:100%">' + th + tb + '</table></div><div style="margin-top:.35rem;color:#94a3b8;font-size:.78rem">' + nota + '</div>';
  }

  function selHtml(id, label, opts, fmt) { return '<span style="display:inline-flex;align-items:center;gap:.35rem"><label style="font-size:.78rem;color:#64748b">' + label + '</label><select id="' + id + '" class="fuente-select" style="min-width:95px;max-width:190px"><option value="">Todas</option>' + (opts || []).map(function (o) { return '<option value="' + esc(o) + '">' + esc(fmt ? fmt(o) : o) + '</option>'; }).join('') + '</select></span>'; }
  function diaHtml(id) { return '<span style="display:inline-flex;align-items:center;gap:.35rem"><label style="font-size:.78rem;color:#64748b">Día</label><input id="' + id + '" type="number" min="1" max="31" class="fuente-select" style="width:72px" placeholder="—"></span>'; }

  function buildBar(tipo, pref, dist) {
    dist = dist || {};
    var parts;
    if (tipo === 'lpr') parts = [selHtml(pref + '-fcam', 'Cámara', dist.cam), selHtml(pref + '-fsent', 'Sentido', dist.sent), selHtml(pref + '-fpais', 'País', dist.pais), selHtml(pref + '-fvtipo', 'Tipo', dist.vtipo), selHtml(pref + '-fmarca', 'Marca', dist.marca), selHtml(pref + '-fcolor', 'Color', dist.color), diaHtml(pref + '-fdia')];
    else if (tipo === 'aforo') parts = [selHtml(pref + '-fmes', 'Mes', dist.mes, mesLbl), diaHtml(pref + '-fdia')];
    else return '';
    return '<div class="filters-bar" style="flex-wrap:wrap;gap:.6rem;margin-bottom:.6rem;align-items:center">' + parts.join('') + '<button type="button" id="' + pref + '-fclear" class="reload-btn" style="background:#e2e8f0;color:#334155">Limpiar filtros</button></div>';
  }
  function bindBar(tipo, pref) {
    var ids = tipo === 'lpr' ? ['fcam', 'fsent', 'fpais', 'fvtipo', 'fmarca', 'fcolor', 'fdia'] : ['fmes', 'fdia'];
    ids.forEach(function (s) { var e = document.getElementById(pref + '-' + s); if (e) e.addEventListener('change', function () { preview(tipo, pref); }); });
    var clr = document.getElementById(pref + '-fclear');
    if (clr) clr.addEventListener('click', function () { ids.forEach(function (s) { var e = document.getElementById(pref + '-' + s); if (e) e.value = ''; }); preview(tipo, pref); });
  }

  function preview(tipo, pref) {
    var sel = document.getElementById(pref + '-select');
    var barEl = document.getElementById(pref + '-filtros');
    var prevEl = document.getElementById(pref + '-preview');
    if (!sel || !prevEl) return;
    var rel = sel.value;
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    var qp = tipo === 'lpr'
      ? { fcam: g(pref + '-fcam'), fsent: g(pref + '-fsent'), fpais: g(pref + '-fpais'), fvtipo: g(pref + '-fvtipo'), fmarca: g(pref + '-fmarca'), fcolor: g(pref + '-fcolor'), fdia: g(pref + '-fdia') }
      : (tipo === 'aforo' ? { fmes: g(pref + '-fmes'), fdia: g(pref + '-fdia') } : {});
    var qs = Object.keys(qp).filter(function (k) { return qp[k]; }).map(function (k) { return k + '=' + encodeURIComponent(qp[k]); }).join('&');
    prevEl.innerHTML = '<div style="padding:.8rem;color:#94a3b8;font-size:.85rem">Cargando…</div>';
    fetch('/api/repositorio/preview?tipo=' + tipo + '&rel=' + encodeURIComponent(rel) + (qs ? '&' + qs : ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { prevEl.innerHTML = '<div style="padding:.8rem;color:#ef4444;font-size:.85rem">' + (j.error || 'Error') + '</div>'; return; }
        if (barEl && repoFileActual[pref] !== rel) { repoFileActual[pref] = rel; barEl.innerHTML = buildBar(tipo, pref, j.distintos); bindBar(tipo, pref); }
        renderTabla(prevEl, j);
      })
      .catch(function (e) { prevEl.innerHTML = '<div style="padding:.8rem;color:#ef4444;font-size:.85rem">' + e.message + '</div>'; });
  }

  function cargarFicheros(tipo, contId, countId) {
    var cont = document.getElementById(contId); if (!cont) return;
    var pref = contId.replace('-ficheros', '');
    cont.innerHTML = '<div style="padding:.6rem;color:#94a3b8;font-size:.85rem">Cargando…</div>';
    fetch('/api/repositorio/ficheros?tipo=' + tipo, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { cont.innerHTML = '<div style="padding:.6rem;color:#ef4444;font-size:.85rem">' + (j.error || 'Error') + '</div>'; return; }
        var cnt = document.getElementById(countId); if (cnt) cnt.textContent = '(' + j.total + ')';
        if (!j.files.length) { cont.innerHTML = '<div style="padding:.6rem;color:#94a3b8;font-size:.85rem">Todavía no hay ficheros.</div>'; return; }
        var fmt = function (d) { try { return new Date(d).toLocaleDateString('es-ES'); } catch (e) { return ''; } };
        var opts = j.files.map(function (f) { return '<option value="' + relDe(f).replace(/"/g, '&quot;') + '">' + (f.carpeta ? f.carpeta + ' / ' : '') + f.nombre + '  ·  ' + f.kb.toLocaleString('es-ES') + ' KB  ·  ' + fmt(f.mtime) + '</option>'; }).join('');
        cont.innerHTML = '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.6rem;flex-wrap:wrap"><span style="color:#64748b;font-size:.82rem">Abrir fichero:</span><select id="' + pref + '-select" class="fuente-select" style="max-width:100%;flex:1;min-width:220px">' + opts + '</select></div><div id="' + pref + '-filtros"></div><div id="' + pref + '-preview"></div>';
        var sel = document.getElementById(pref + '-select');
        sel.addEventListener('change', function () { repoFileActual[pref] = null; preview(tipo, pref); });
        repoFileActual[pref] = null;
        preview(tipo, pref);
      })
      .catch(function (e) { cont.innerHTML = '<div style="padding:.6rem;color:#ef4444;font-size:.85rem">' + e.message + '</div>'; });
  }

  function setCount(tipo) { fetch('/api/repositorio/ficheros?tipo=' + tipo, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { var c = document.getElementById('repo-' + tipo + '-count'); if (c && j.ok) c.textContent = '(' + j.total + ')'; }).catch(function () {}); }

  function initCamTabs() {
    var tabs = document.querySelectorAll('.repo-tab');
    if (!tabs.length) return;
    setCount('lpr'); setCount('aforo');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); x.style.background = '#e2e8f0'; x.style.color = '#334155'; });
        t.classList.add('active'); t.style.background = ''; t.style.color = '';
        var tipo = t.dataset.repo;
        cargarFicheros(tipo, 'repo-cam-ficheros', 'repo-' + tipo + '-count');
      });
    });
    cargarFicheros('lpr', 'repo-cam-ficheros', 'repo-lpr-count');
  }

  function init() {
    initCamTabs();
    cargarFicheros('pesajes', 'repo-pesajes-ficheros', 'repo-pesajes-count');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
