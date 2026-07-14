/**
 * Repositorio de subida de ficheros para el cuadro de mando.
 * El encargado del ayuntamiento sube desde la web:
 *   - Residuos: Excel de pesajes  (POST /api/repositorio/pesajes)
 *   - Cámaras LPR: CSV de matrículas  (POST /api/repositorio/lpr)
 *   - Cámaras aforo: CSV multiobjeto  (POST /api/repositorio/aforo)
 * Al subir se guardan en su carpeta (sustituyendo el mismo mes) y se lanza el
 * reproceso correspondiente en segundo plano. El estado se consulta en
 *   GET /api/repositorio/estado
 *
 * Pensado para el servidor donde viven los datos y los scripts (no en Render).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const multer = require('multer');
let XLSX = null; try { XLSX = require('xlsx'); } catch (_) { /* opcional */ }

const ROOT = __dirname;
const TMP = path.join(ROOT, 'data', '_uploads_tmp');
const PESAJES_DIR = path.join(ROOT, 'data', 'RESIDUOS', 'pesajes');
const LPR_DIR = path.join(ROOT, 'data', 'camaras', 'Trafico_camaras', 'CSV');
const AFORO_DIR = path.join(ROOT, 'data', 'camaras', 'Camaras_Multiobjeto', 'CSV');
const BASELINE = path.join(ROOT, 'data', 'camaras', 'camaras_conocidas.json');

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, TMP), filename: (r, f, cb) => cb(null, Date.now() + '_' + f.originalname.replace(/[^\w.\-() ñÑáéíóúÁÉÍÓÚ]/g, '_')) }),
    limits: { fileSize: 400 * 1024 * 1024 } // 400 MB (los CSV de matrículas pesan mucho)
});

// Estado global compartido (un reproceso pesado a la vez).
const estado = { procesando: false, tipo: null, inicio: null, ultimo: null };

function nombreLimpio(orig) { return orig.replace(/[^\w.\-() ñÑáéíóúÁÉÍÓÚ]/g, '_'); }

// --- Inferencia de mes/año ---
function inferPesajes(nombre) {
    const stem = nombre.replace(/\.(xlsx|xls)$/i, '');
    const low = stem.toLowerCase();
    let month = null, year = null;
    const lead = stem.match(/^(\d{1,2})\s*-\s*/);
    if (lead) { const m = parseInt(lead[1], 10); if (m >= 1 && m <= 12) month = m; }
    if (!month) for (const [n, num] of Object.entries(MESES)) { if (low.includes(n)) { month = num; break; } }
    const y4 = stem.match(/\b(20\d{2})\b/);
    if (y4) year = parseInt(y4[1], 10);
    else { const y2 = stem.match(/(\d{2})\s*(?:\([^)]*\))?\s*$/); if (y2) { const n = parseInt(y2[1], 10); year = n <= 40 ? 2000 + n : 1900 + n; } }
    return { month, year };
}
function ymLpr(nombre) {
    const m6 = nombre.match(/(20\d{2})(\d{2})/); // 202606
    if (m6) return m6[1].slice(2) + m6[2];
    const m4 = nombre.match(/^(\d{2})(\d{2})\b/); // 2606
    if (m4) return m4[1] + m4[2];
    return null;
}

function limpiarTmp(files) { (files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch (_) {} }); }

// --- Reproceso en segundo plano ---
function camarasNuevas() {
    try {
        if (!fs.existsSync(BASELINE)) return [];
        const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
        const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'camaras', 'todos.json'), 'utf8'));
        const actualesLpr = Object.keys((d.lpr && d.lpr.byCamara) || {});
        const conocidas = new Set(base.lpr || []);
        return actualesLpr.filter((c) => !conocidas.has(c));
    } catch (_) { return []; }
}
function lanzarReproceso(tipo, ficheros) {
    estado.procesando = true; estado.tipo = tipo; estado.inicio = Date.now();
    const cmd = tipo === 'pesajes' ? { c: 'python', a: ['preparar_datos.py'] } : { c: 'node', a: ['procesar_camaras.js'] };
    let out = '';
    const proc = spawn(cmd.c, cmd.a, { cwd: ROOT });
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
        const nuevas = tipo === 'pesajes' ? [] : camarasNuevas();
        estado.procesando = false;
        estado.ultimo = {
            tipo, ok: code === 0, fin: new Date().toISOString(), ficheros,
            camarasNuevas: nuevas,
            mensaje: code === 0
                ? `Procesado correctamente${nuevas.length ? '. ⚠ Cámaras LPR nuevas detectadas: ' + nuevas.join(', ') : ''}`
                : ('Error al procesar (código ' + code + '). ' + out.split('\n').slice(-4).join(' ').slice(0, 300))
        };
        console.log('[repositorio] Reproceso', tipo, code === 0 ? 'OK' : 'FALLÓ', nuevas.length ? '(nuevas: ' + nuevas.join(', ') + ')' : '');
    });
    proc.on('error', (e) => { estado.procesando = false; estado.ultimo = { tipo, ok: false, fin: new Date().toISOString(), ficheros, mensaje: 'No se pudo lanzar el reproceso: ' + e.message }; });
}

function registrar(app) {
    // --- Pesajes (Excel) ---
    app.post('/api/repositorio/pesajes', upload.array('file', 24), (req, res) => {
        if (estado.procesando) { limpiarTmp(req.files); return res.status(409).json({ ok: false, error: 'Ya hay un reproceso en curso, espera a que termine.' }); }
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibió ningún fichero.' });
        const guardados = [];
        for (const f of files) {
            if (!/\.(xlsx|xls)$/i.test(f.originalname)) { limpiarTmp([f]); continue; }
            const { year } = inferPesajes(f.originalname);
            const anio = year || new Date().getFullYear();
            const dir = path.join(PESAJES_DIR, String(anio));
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            // sustituye el mismo mes (mismo prefijo "MM -")
            const lead = f.originalname.match(/^(\d{1,2})\s*-/);
            if (lead) { for (const ex of fs.readdirSync(dir)) { const l2 = ex.match(/^(\d{1,2})\s*-/); if (l2 && parseInt(l2[1], 10) === parseInt(lead[1], 10)) { try { fs.unlinkSync(path.join(dir, ex)); } catch (_) {} } } }
            const dest = path.join(dir, nombreLimpio(f.originalname));
            fs.renameSync(f.path, dest);
            guardados.push(path.relative(ROOT, dest));
        }
        if (!guardados.length) return res.status(400).json({ ok: false, error: 'Los ficheros no son Excel (.xlsx/.xls).' });
        lanzarReproceso('pesajes', guardados);
        res.json({ ok: true, guardados, procesando: true, mensaje: 'Ficheros guardados. Reprocesando residuos…' });
    });

    // --- Cámaras LPR (CSV de matrículas) ---
    app.post('/api/repositorio/lpr', upload.array('file', 24), (req, res) => {
        if (estado.procesando) { limpiarTmp(req.files); return res.status(409).json({ ok: false, error: 'Ya hay un reproceso en curso, espera a que termine.' }); }
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibió ningún fichero.' });
        if (!fs.existsSync(LPR_DIR)) fs.mkdirSync(LPR_DIR, { recursive: true });
        const guardados = [];
        for (const f of files) {
            if (!/\.csv$/i.test(f.originalname)) { limpiarTmp([f]); continue; }
            const ym = ymLpr(f.originalname);
            // sustituye el mismo mes para no duplicar
            if (ym) { for (const ex of fs.readdirSync(LPR_DIR)) { if (ymLpr(ex) === ym) { try { fs.unlinkSync(path.join(LPR_DIR, ex)); } catch (_) {} } } }
            const dest = path.join(LPR_DIR, nombreLimpio(f.originalname));
            fs.renameSync(f.path, dest);
            guardados.push(path.relative(ROOT, dest));
        }
        if (!guardados.length) return res.status(400).json({ ok: false, error: 'Los ficheros no son CSV.' });
        lanzarReproceso('camaras', guardados);
        res.json({ ok: true, guardados, procesando: true, mensaje: 'CSV guardados. Reprocesando cámaras…' });
    });

    // --- Cámaras aforo (CSV multiobjeto) ---
    app.post('/api/repositorio/aforo', upload.array('file', 24), (req, res) => {
        if (estado.procesando) { limpiarTmp(req.files); return res.status(409).json({ ok: false, error: 'Ya hay un reproceso en curso, espera a que termine.' }); }
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ ok: false, error: 'No se recibió ningún fichero.' });
        if (!fs.existsSync(AFORO_DIR)) fs.mkdirSync(AFORO_DIR, { recursive: true });
        const carpetas = fs.existsSync(AFORO_DIR) ? fs.readdirSync(AFORO_DIR).filter((n) => fs.statSync(path.join(AFORO_DIR, n)).isDirectory()) : [];
        const guardados = [];
        for (const f of files) {
            if (!/\.csv$/i.test(f.originalname)) { limpiarTmp([f]); continue; }
            // lee cabecera (latin1) para sacar la cámara ("Objetivo de estadísticas: X")
            let cabecera = '';
            try { cabecera = fs.readFileSync(f.path, 'latin1').slice(0, 2000); } catch (_) {}
            const mCam = cabecera.match(/Objetivo de estad[ií]sticas:\s*([^;\n\r"]+)/i);
            const camara = mCam ? mCam[1].trim() : '';
            // busca carpeta existente cuyo nombre (sin "NN - ") coincida
            let folder = camara && carpetas.find((c) => c.replace(/^\d+\s*-\s*/, '').trim().toLowerCase() === camara.toLowerCase());
            if (!folder) folder = camara || 'Sin cámara';
            const dir = path.join(AFORO_DIR, folder);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, nombreLimpio(f.originalname));
            fs.renameSync(f.path, dest);
            guardados.push(path.relative(ROOT, dest) + (camara ? '  (' + camara + ')' : ''));
        }
        if (!guardados.length) return res.status(400).json({ ok: false, error: 'Los ficheros no son CSV.' });
        lanzarReproceso('camaras', guardados);
        res.json({ ok: true, guardados, procesando: true, mensaje: 'CSV de aforo guardados. Reprocesando cámaras…' });
    });

    // --- Estado del reproceso ---
    app.get('/api/repositorio/estado', (req, res) => {
        res.json({ procesando: estado.procesando, tipo: estado.tipo, desde: estado.inicio, ultimo: estado.ultimo });
    });

    // --- Listado de ficheros del repositorio (para mostrar "todos los excels/csv") ---
    app.get('/api/repositorio/ficheros', (req, res) => {
        const tipo = req.query.tipo;
        let dir, ext, recursive = false;
        if (tipo === 'pesajes') { dir = PESAJES_DIR; ext = /\.(xlsx|xls)$/i; recursive = true; }
        else if (tipo === 'lpr') { dir = LPR_DIR; ext = /\.csv$/i; }
        else if (tipo === 'aforo') { dir = AFORO_DIR; ext = /\.csv$/i; recursive = true; }
        else return res.status(400).json({ ok: false, error: 'tipo inválido (pesajes|lpr|aforo)' });
        const files = [];
        (function walk(d) {
            if (!fs.existsSync(d)) return;
            for (const it of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, it.name);
                if (it.isDirectory()) { if (recursive) walk(full); }
                else if (ext.test(it.name)) {
                    let st; try { st = fs.statSync(full); } catch (_) { continue; }
                    const rel = path.relative(dir, full).replace(/\\/g, '/');
                    files.push({ nombre: it.name, carpeta: path.dirname(rel) === '.' ? '' : path.dirname(rel), kb: Math.round(st.size / 1024), mtime: st.mtime });
                }
            }
        })(dir);
        files.sort((a, b) => (a.carpeta + '/' + a.nombre).localeCompare(b.carpeta + '/' + b.nombre, 'es'));
        res.json({ ok: true, tipo, total: files.length, files });
    });

    // --- Preview del contenido de un fichero (primeras filas), estilo visor de tablas ---
    function dirDeTipo(tipo) {
        if (tipo === 'pesajes') return { dir: PESAJES_DIR, enc: 'xlsx' };
        if (tipo === 'lpr') return { dir: LPR_DIR, enc: 'utf8' };
        if (tipo === 'aforo') return { dir: AFORO_DIR, enc: 'latin1' };
        return null;
    }
    app.get('/api/repositorio/preview', (req, res) => {
        const conf = dirDeTipo(req.query.tipo);
        if (!conf) return res.status(400).json({ ok: false, error: 'tipo inválido' });
        const relNorm = String(req.query.rel || '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
        const base = path.resolve(conf.dir);
        const abs = path.resolve(base, relNorm);
        if (abs.toLowerCase() !== base.toLowerCase() && !abs.toLowerCase().startsWith(base.toLowerCase() + path.sep)) return res.status(400).json({ ok: false, error: 'ruta no válida' });
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ ok: false, error: 'no encontrado' });
        const MAX = 200;
        if (conf.enc === 'xlsx') {
            if (!XLSX) return res.status(500).json({ ok: false, error: 'XLSX no disponible' });
            try {
                const wb = XLSX.readFile(abs, { sheetRows: MAX + 1 });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(0, MAX).map((r) => r.map((c) => (c == null ? '' : String(c))));
                return res.json({ ok: true, nombre: path.basename(abs), hoja: wb.SheetNames[0], filas, truncado: filas.length >= MAX });
            } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
        }
        // CSV: leemos las primeras líneas en streaming (los CSV de matrículas pesan mucho)
        // y las parseamos en una tabla LIMPIA con columnas con sentido según el tipo.
        const lineas = [];
        let n = 0, cerrado = false;
        const rl = readline.createInterface({ input: fs.createReadStream(abs, { encoding: conf.enc }), crlfDelay: Infinity });
        rl.on('line', (l) => { if (n++ >= 400) { if (!cerrado) { cerrado = true; rl.close(); } return; } lineas.push(l.replace(/^﻿/, '')); });
        rl.on('close', () => {
            if (res.headersSent) return;
            const clean = (s) => String(s == null ? '' : s).replace(/"/g, '').replace(/^\s*=/, '').trim();
            const split = (l) => l.split(l.indexOf(';') >= 0 ? ';' : ',').map(clean);
            let filas = [];
            if (req.query.tipo === 'lpr') {
                const hi = lineas.findIndex((l) => /matr[ií]cula/i.test(l) && /c[aá]mara/i.test(l));
                if (hi >= 0) {
                    const cols = split(lineas[hi]);
                    const idx = (re) => cols.findIndex((c) => re.test(c));
                    const map = [
                        ['Matrícula', idx(/matr[ií]cula/i)], ['Hora', idx(/^hora$/i)], ['Cámara', idx(/c[aá]mara/i)],
                        ['País', idx(/pa[ií]s|regi[oó]n/i)], ['Tipo', idx(/tipo/i)], ['Marca', idx(/^marca$/i)],
                        ['Color', idx(/^color$/i)], ['Sentido', idx(/direcci[oó]n/i)]
                    ].filter((m) => m[1] >= 0);
                    filas.push(map.map((m) => m[0]));
                    for (let i = hi + 1; i < lineas.length && filas.length <= MAX; i++) {
                        const p = split(lineas[i]); if (!p.some((c) => c)) continue;
                        filas.push(map.map((m) => p[m[1]] || ''));
                    }
                }
            } else if (req.query.tipo === 'aforo') {
                filas.push(['Fecha', 'Personas ⬇', 'Personas ⬆', 'Veh. motor ⬇', 'Veh. motor ⬆', 'Veh. sin motor ⬇', 'Veh. sin motor ⬆']);
                for (let i = 0; i < lineas.length && filas.length <= MAX; i++) {
                    if (filas.length > 1 && /Exportar contenido/i.test(lineas[i])) break;
                    const p = split(lineas[i]);
                    const m = (p[1] || '').match(/(\d{4})\/(\d{2})\/(\d{2})/);
                    if (!m) continue;
                    filas.push([m[3] + '/' + m[2] + '/' + m[1], p[2] || '', p[5] || '', p[8] || '', p[11] || '', p[14] || '', p[17] || '']);
                }
            }
            if (!filas.length) { // fallback: crudo sin metadatos de una sola celda
                filas = lineas.map(split).filter((f) => f.filter((c) => c).length >= 2).slice(0, MAX);
            }
            res.json({ ok: true, nombre: path.basename(abs), filas, truncado: n >= 400 });
        });
        rl.on('error', (e) => { if (!res.headersSent) res.status(500).json({ ok: false, error: e.message }); });
    });

    // Errores de multer (tamaño, etc.)
    app.use('/api/repositorio', (err, req, res, next) => {
        if (err) return res.status(400).json({ ok: false, error: err.message || 'Error en la subida' });
        next();
    });
}

module.exports = { registrar };
