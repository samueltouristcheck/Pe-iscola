/**
 * Repositorio de subida de datos (Cámaras / Residuos).
 * Sube el fichero al servidor, que lo guarda en su carpeta y reprocesa solo.
 * Sondea /api/repositorio/estado hasta que termina y muestra el resultado.
 * Funciona en el servidor donde viven los datos y los scripts (local/self-host).
 */
(function () {
  'use strict';

  function poll(statusEl) {
    var t = setInterval(function () {
      fetch('/api/repositorio/estado', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.procesando) {
            var mins = s.desde ? Math.max(0, Math.round((Date.now() - s.desde) / 60000)) : 0;
            statusEl.innerHTML = '⏳ <b>Procesando…</b> (' + mins + ' min) — no cierres la página.';
            return;
          }
          clearInterval(t);
          var u = s.ultimo || {};
          if (u.ok) {
            var extra = (u.camarasNuevas && u.camarasNuevas.length)
              ? '<br><b style="color:#d97706">⚠ Cámaras LPR nuevas detectadas: ' + u.camarasNuevas.join(', ') + '</b> (avísame para añadir sus coordenadas).'
              : '';
            statusEl.innerHTML = '✅ <b>Actualizado correctamente.</b>' + extra + '<br>Recarga la página (Ctrl+F5) para ver los datos nuevos.';
            cargarTodosFicheros();
          } else {
            statusEl.innerHTML = '<span style="color:#ef4444">❌ ' + (u.mensaje || 'Error al procesar.') + '</span>';
          }
        })
        .catch(function () { /* reintenta en el siguiente tick */ });
    }, 3000);
  }

  function subir(endpoint, input, btn, statusEl) {
    if (!input.files || !input.files.length) {
      statusEl.innerHTML = '<span style="color:#d97706">Selecciona al menos un fichero.</span>';
      return;
    }
    var fd = new FormData();
    for (var i = 0; i < input.files.length; i++) fd.append('file', input.files[i]);
    btn.disabled = true;
    statusEl.innerHTML = '⏳ Subiendo fichero(s)…';
    fetch(endpoint, { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.j.ok) {
          statusEl.innerHTML = '<span style="color:#ef4444">❌ ' + (res.j && res.j.error ? res.j.error : 'Error al subir.') + '</span>';
          return;
        }
        input.value = '';
        statusEl.innerHTML = '✅ Subido: ' + (res.j.guardados || []).join('<br>') + '<br>⏳ <b>Procesando…</b> (puede tardar varios minutos, no cierres la página).';
        poll(statusEl);
      })
      .catch(function (e) {
        btn.disabled = false;
        statusEl.innerHTML = '<span style="color:#ef4444">❌ ' + e.message + '</span>';
      });
  }

  function relDe(f) { return f.carpeta ? f.carpeta + '/' + f.nombre : f.nombre; }

  function previewFichero(tipo, rel, prevEl) {
    prevEl.innerHTML = '<div style="padding:.8rem;color:#94a3b8;font-size:.85rem">Cargando vista previa…</div>';
    fetch('/api/repositorio/preview?tipo=' + tipo + '&rel=' + encodeURIComponent(rel), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { prevEl.innerHTML = '<div style="padding:.8rem;color:#ef4444;font-size:.85rem">' + (j.error || 'Error') + '</div>'; return; }
        var filas = (j.filas || []).filter(function (f) { return f && f.some(function (c) { return String(c).trim() !== ''; }); });
        if (!filas.length) { prevEl.innerHTML = '<div style="padding:.8rem;color:#94a3b8;font-size:.85rem">Sin contenido.</div>'; return; }
        var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        var nCols = filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0);
        var head = filas[0];
        var body = filas.slice(1);
        var th = '<tr>' + Array.from({ length: nCols }).map(function (_, i) { return '<th style="position:sticky;top:0;background:#1e293b;color:#fff;padding:.4rem .55rem;text-align:left;font-weight:600;white-space:nowrap;font-size:.78rem">' + esc(head[i] || '') + '</th>'; }).join('') + '</tr>';
        var tb = body.map(function (fila, ri) {
          return '<tr style="background:' + (ri % 2 ? '#f8fafc' : '#fff') + '">' + Array.from({ length: nCols }).map(function (_, i) { return '<td style="padding:.35rem .55rem;border-bottom:1px solid #f1f5f9;white-space:nowrap;color:#334155">' + esc(fila[i] || '') + '</td>'; }).join('') + '</tr>';
        }).join('');
        prevEl.innerHTML = '<div style="max-height:68vh;overflow:auto;border:1px solid #e2e8f0;border-radius:8px"><table style="border-collapse:collapse;font-size:.85rem;min-width:100%">' + th + tb + '</table></div>' +
          '<div style="margin-top:.35rem;color:#94a3b8;font-size:.78rem">Mostrando ' + body.length + ' filas' + (j.truncado ? ' (primeras 200)' : '') + '</div>';
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
        cont.innerHTML =
          '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;flex-wrap:wrap">' +
          '<span style="color:#64748b;font-size:.82rem">Abrir fichero:</span>' +
          '<select id="' + pref + '-select" class="fuente-select" style="max-width:100%;flex:1;min-width:220px">' + opts + '</select>' +
          '</div><div id="' + pref + '-preview"></div>';
        var sel = document.getElementById(pref + '-select');
        var prevEl = document.getElementById(pref + '-preview');
        var abrir = function () { previewFichero(tipo, sel.value, prevEl); };
        sel.addEventListener('change', abrir);
        abrir(); // previsualiza el primero
      })
      .catch(function (e) { cont.innerHTML = '<div style="padding:.6rem;color:#ef4444;font-size:.85rem">' + e.message + '</div>'; });
  }
  function setCount(tipo) {
    fetch('/api/repositorio/ficheros?tipo=' + tipo, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { var c = document.getElementById('repo-' + tipo + '-count'); if (c && j.ok) c.textContent = '(' + j.total + ')'; })
      .catch(function () {});
  }
  var repoCamTipo = 'lpr';
  function initCamTabs() {
    var tabs = document.querySelectorAll('.repo-tab');
    if (!tabs.length) return;
    setCount('lpr'); setCount('aforo');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); x.style.background = '#e2e8f0'; x.style.color = '#334155'; });
        t.classList.add('active'); t.style.background = ''; t.style.color = '';
        repoCamTipo = t.dataset.repo;
        cargarFicheros(repoCamTipo, 'repo-cam-ficheros', 'repo-' + repoCamTipo + '-count');
      });
    });
    cargarFicheros('lpr', 'repo-cam-ficheros', 'repo-lpr-count');
  }
  function cargarTodosFicheros() {
    initCamTabs();
    cargarFicheros('pesajes', 'repo-pesajes-ficheros', 'repo-pesajes-count');
  }

  function bind(btnId, endpoint, inputId, statusId) {
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    var statusEl = document.getElementById(statusId);
    if (!btn || !input || !statusEl) return;
    btn.addEventListener('click', function () { subir(endpoint, input, btn, statusEl); });
  }

  function init() {
    cargarTodosFicheros();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
