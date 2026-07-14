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

  function cargarFicheros(tipo, contId, countId) {
    var cont = document.getElementById(contId); if (!cont) return;
    cont.innerHTML = '<div style="padding:.6rem;color:#94a3b8;font-size:.85rem">Cargando…</div>';
    fetch('/api/repositorio/ficheros?tipo=' + tipo, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { cont.innerHTML = '<div style="padding:.6rem;color:#ef4444;font-size:.85rem">' + (j.error || 'Error') + '</div>'; return; }
        var cnt = document.getElementById(countId); if (cnt) cnt.textContent = '(' + j.total + ')';
        if (!j.files.length) { cont.innerHTML = '<div style="padding:.6rem;color:#94a3b8;font-size:.85rem">Todavía no hay ficheros.</div>'; return; }
        var fmt = function (d) { try { return new Date(d).toLocaleDateString('es-ES'); } catch (e) { return ''; } };
        var rows = j.files.map(function (f) {
          return '<tr style="border-top:1px solid #f1f5f9"><td style="padding:.35rem .5rem;color:#334155">' + (f.carpeta ? '<span style="color:#94a3b8">' + f.carpeta + '/</span>' : '') + f.nombre + '</td><td style="padding:.35rem .5rem;text-align:right;color:#64748b;white-space:nowrap">' + f.kb.toLocaleString('es-ES') + ' KB</td><td style="padding:.35rem .5rem;text-align:right;color:#94a3b8;white-space:nowrap">' + fmt(f.mtime) + '</td></tr>';
        }).join('');
        cont.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:.82rem"><tbody>' + rows + '</tbody></table>';
      })
      .catch(function (e) { cont.innerHTML = '<div style="padding:.6rem;color:#ef4444;font-size:.85rem">' + e.message + '</div>'; });
  }
  function cargarTodosFicheros() {
    cargarFicheros('lpr', 'repo-lpr-ficheros', 'repo-lpr-count');
    cargarFicheros('aforo', 'repo-aforo-ficheros', 'repo-aforo-count');
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
    bind('repo-lpr-btn', '/api/repositorio/lpr', 'repo-lpr-file', 'repo-lpr-status');
    bind('repo-aforo-btn', '/api/repositorio/aforo', 'repo-aforo-file', 'repo-aforo-status');
    bind('repo-pesajes-btn', '/api/repositorio/pesajes', 'repo-pesajes-file', 'repo-pesajes-status');
    cargarTodosFicheros();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
