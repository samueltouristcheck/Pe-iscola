/**
 * Servidor para el dashboard de Peñíscola.
 * Sirve los archivos estáticos, /api/chat para el chatbot y /api/generate-report para informes.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const EJEMPLOS_DIR = path.join(__dirname, 'informes_ejemplo');
const PESAJES_ROOT = path.join(__dirname, 'data', 'RESIDUOS', 'pesajes');
const PORT = process.env.PORT || 7777;

const MESES_PESAJES_EXCEL = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

function inferPesajesExcelMeta(relPosix, baseName) {
    let year = null;
    let month = null;
    for (const seg of relPosix.split(/[/\\]/)) {
        if (/^\d{4}$/.test(seg)) {
            const y = parseInt(seg, 10);
            if (y >= 1990 && y <= 2100) year = y;
        }
    }
    const stem = baseName.replace(/\.(xlsx|xls)$/i, '');
    const low = stem.toLowerCase();
    for (const [nom, num] of Object.entries(MESES_PESAJES_EXCEL)) {
        if (low.includes(nom)) {
            month = num;
            break;
        }
    }
    const lead = stem.match(/^(\d{1,2})\s*-\s*/);
    if (lead) {
        const mm = parseInt(lead[1], 10);
        if (mm >= 1 && mm <= 12) month = mm;
    }
    const y4 = stem.match(/\b(20\d{2}|19\d{2})\b/);
    if (y4) year = parseInt(y4[1], 10);
    if (!y4) {
        const shortY = stem.match(/(\d{2})(?:\s*\([^)]*\))?\s*$/);
        if (shortY) {
            const n = parseInt(shortY[1], 10);
            year = n <= 30 ? 2000 + n : 1900 + n;
        }
    }
    let yearMonth = null;
    if (year != null && month != null) {
        yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    }
    return { year, month, yearMonth };
}

function walkPesajesExcels(absDir, baseDir, out) {
    if (!fs.existsSync(absDir)) return;
    let names;
    try {
        names = fs.readdirSync(absDir);
    } catch (e) {
        return;
    }
    for (const name of names) {
        if (name.startsWith('~$')) continue;
        if (name === 'todos.json') continue;
        const full = path.join(absDir, name);
        let st;
        try {
            st = fs.statSync(full);
        } catch (e) {
            continue;
        }
        if (st.isDirectory()) {
            walkPesajesExcels(full, baseDir, out);
        } else if (/\.(xlsx|xls)$/i.test(name)) {
            const rel = path.relative(baseDir, full).split(path.sep).join('/');
            const meta = inferPesajesExcelMeta(rel, name);
            out.push({
                rel,
                name,
                year: meta.year,
                month: meta.month,
                yearMonth: meta.yearMonth
            });
        }
    }
}

// Compresión gzip/brotli para JSON grandes (data/* a veces > 10 MB)
app.use(compression());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.json());

// Health check público (Render lo usa para "is the service alive?")
app.get('/api/status', (req, res) => res.json({ ok: true, server: 'Node.js', htmlReport: true }));

// Basic Auth: si DASH_USER y DASH_PASS están definidos, el resto del sitio requiere login.
// En local sin esas variables, no hay auth (modo dev).
app.use((req, res, next) => {
    const u = process.env.DASH_USER;
    const p = process.env.DASH_PASS;
    if (!u || !p) return next();
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
        try {
            const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
            if (user === u && pass === p) return next();
        } catch (_) { /* malformed header */ }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Peniscola Dashboard", charset="UTF-8"');
    res.status(401).send('Autenticación requerida');
});

// Rate limit en /api/chat para proteger la cuota de OpenAI
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Espera un minuto.' }
});

// Ruta raíz: devolver index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API ligera para dashboard (evita cargar 2.5MB)
app.get('/api/camaras/dashboard', (req, res) => {
    const p = path.join(__dirname, 'data', 'camaras', 'todos.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Archivo no encontrado' });
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        const lpr = data.lpr || {};
        res.json({
            lpr: {
                entradasSalidasPorMes: lpr.entradasSalidasPorMes || {},
                entradasSalidasPorDia: lpr.entradasSalidasPorDia || {},
                entradasSalidasPorHora: lpr.entradasSalidasPorHora || {},
                byCamara: lpr.byCamara || {},
                byNacionalidad: lpr.byNacionalidad || {},
                byColor: lpr.byColor || {},
                agregados: lpr.agregados || []
            },
            camarasMapa: data.camarasMapa || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Rutas explícitas para datos (asegura que se sirvan correctamente)
app.get('/data/camaras/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'camaras', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/resumen.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'resumen.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/TURISMO/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'TURISMO', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Datos de turismo aún no descargados. Pulsa Actualizar INE.' });
});
app.get('/api/turismo/data', (req, res) => {
    const p = path.join(__dirname, 'data', 'TURISMO', 'todos.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Sin datos descargados' });
    try { res.json(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (e) { res.status(500).json({ error: e.message }); }
});
let turismoRefreshing = false;
let ultimaActualizacionTurismo = null;
function ejecutarDescargaTurismo() {
    if (turismoRefreshing) return Promise.resolve({ ok: false, busy: true });
    turismoRefreshing = true;
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const proc = spawn('node', ['procesar_turismo.js'], { cwd: __dirname });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            turismoRefreshing = false;
            if (code === 0) {
                ultimaActualizacionTurismo = new Date().toISOString();
                console.log('[turismo] Datos INE actualizados.');
                resolve({ ok: true, code, ultimaActualizacion: ultimaActualizacionTurismo });
            } else {
                console.warn('[turismo] Descarga fallida:', stderr.trim() || stdout.trim());
                resolve({ ok: false, code, error: stderr.trim() || 'exit ' + code });
            }
        });
        proc.on('error', (e) => { turismoRefreshing = false; resolve({ ok: false, error: e.message }); });
    });
}
app.post('/api/turismo/refresh', async (req, res) => {
    const result = await ejecutarDescargaTurismo();
    if (result.ok) res.json(result);
    else res.status(result.busy ? 429 : 500).json(result);
});
app.get('/api/turismo/status', (req, res) => {
    const p = path.join(__dirname, 'data', 'TURISMO', 'todos.json');
    const existe = fs.existsSync(p);
    res.json({
        existe,
        refrescando: turismoRefreshing,
        ultimaActualizacionMemoria: ultimaActualizacionTurismo,
        mtime: existe ? fs.statSync(p).mtime : null
    });
});
app.get('/data/RESIDUOS/pesajes/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'pesajes', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/pesajes/excels_manifest.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'pesajes', 'excels_manifest.json');
    if (fs.existsSync(p)) {
        res.type('application/json');
        res.sendFile(p);
    } else res.status(404).json({ error: 'Archivo no encontrado', files: [] });
});

/** Lista recursiva de Excels en data/RESIDUOS/pesajes (año/mes inferidos de ruta y nombre). */
app.get('/api/residuos/pesajes/excels', (req, res) => {
    try {
        const files = [];
        walkPesajesExcels(PESAJES_ROOT, PESAJES_ROOT, files);
        files.sort((a, b) => {
            if (a.yearMonth && b.yearMonth) {
                const c = a.yearMonth.localeCompare(b.yearMonth);
                if (c !== 0) return c;
            } else if (a.yearMonth) return -1;
            else if (b.yearMonth) return 1;
            if (a.year != null && b.year != null && a.year !== b.year) return a.year - b.year;
            return a.rel.localeCompare(b.rel, 'es');
        });
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message, files: [] });
    }
});
function resolvePesajesRel(rel) {
    if (rel == null || typeof rel !== 'string' || !rel.trim()) return null;
    const relNorm = rel.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
    if (!relNorm || relNorm.includes('..')) return null;
    const base = path.resolve(PESAJES_ROOT);
    const abs = path.resolve(base, relNorm);
    const baseLower = base.toLowerCase();
    const absLower = abs.toLowerCase();
    if (!absLower.startsWith(baseLower + path.sep) && absLower !== baseLower) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    if (!/\.(xlsx|xls)$/i.test(abs)) return null;
    return abs;
}

const PREVIEW_MAX_ROWS = 4001;
const PREVIEW_MAX_COLS = 100;

function sendPesajesExcelPreview(rel, res) {
    try {
        const abs = resolvePesajesRel(rel);
        if (!abs) {
            return res.status(400).json({
                error: 'Ruta no válida o archivo no encontrado',
                sheetName: null,
                table: [],
                rowCount: 0
            });
        }
        const wb = XLSX.readFile(abs, { cellDates: true, dense: false });
        const sheetName = wb.SheetNames[0] || 'Hoja1';
        const sheet = wb.Sheets[sheetName];
        if (!sheet) {
            return res.json({ sheetName, table: [], rowCount: 0, truncated: false, truncatedCols: false });
        }
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false });
        const fmtCell = (v) => {
            if (v == null || v === '') return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
            if (v instanceof Date) {
                try {
                    return v.toISOString().replace('T', ' ').slice(0, 19);
                } catch (e) {
                    return String(v);
                }
            }
            return String(v);
        };
        const maxColWidth = raw.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
        let colCap = Math.min(maxColWidth || 0, PREVIEW_MAX_COLS);
        if (raw.length > 0 && colCap === 0) colCap = Math.min(PREVIEW_MAX_COLS, Math.max(1, Array.isArray(raw[0]) ? raw[0].length : 0));
        const rowCap = Math.min(raw.length, PREVIEW_MAX_ROWS);
        const table = [];
        for (let i = 0; i < rowCap; i++) {
            const row = Array.isArray(raw[i]) ? raw[i] : [];
            const o = [];
            for (let j = 0; j < colCap; j++) o.push(fmtCell(row[j]));
            table.push(o);
        }
        res.json({
            sheetName,
            rel: path.relative(PESAJES_ROOT, abs).split(path.sep).join('/'),
            table,
            rowCount: raw.length,
            truncated: raw.length > rowCap,
            truncatedCols: (maxColWidth || 0) > PREVIEW_MAX_COLS
        });
    } catch (e) {
        res.status(500).json({
            error: e.message || 'Error leyendo Excel',
            sheetName: null,
            table: [],
            rowCount: 0
        });
    }
}

/** Primera hoja del Excel como tabla (GET rel en query o POST JSON { rel }). */
app.get('/api/residuos/pesajes/preview', (req, res) => {
    sendPesajesExcelPreview(req.query.rel, res);
});
app.post('/api/residuos/pesajes/preview', (req, res) => {
    const rel = req.body && req.body.rel;
    sendPesajesExcelPreview(rel, res);
});
app.get('/data/RESIDUOS/camion/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
/** API paginada para todos los registros del camión (todos.json, 580k rows, 225MB).
 *  GET /api/residuos/camion/registros?year=2022&mes=2022-01&zona=X&tipo=Y&containerType=Z&matricula=W&page=0&perPage=150
 */
let _camionTodosCache = null;
function loadCamionCache() {
    if (_camionTodosCache) return _camionTodosCache;
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'todos.json');
    if (!fs.existsSync(p)) return null;
    _camionTodosCache = JSON.parse(fs.readFileSync(p, 'utf8'));
    return _camionTodosCache;
}
function filterCamion(rows, q) {
    let r = rows;
    if (q.year)          r = r.filter((x) => x.fecha && String(x.fecha).startsWith(q.year));
    if (q.mes)           r = r.filter((x) => x.fecha === q.mes);
    if (q.zona)          r = r.filter((x) => x.zona          === q.zona);
    if (q.tipo)          r = r.filter((x) => (x.tipo || x.garbage) === q.tipo);
    if (q.containerType) r = r.filter((x) => x.containerType === q.containerType);
    if (q.matricula)     r = r.filter((x) => x.matricula && x.matricula.toLowerCase().includes(q.matricula.toLowerCase()));
    return r;
}
app.get('/api/residuos/camion/registros', (req, res) => {
    try {
        const data = loadCamionCache();
        if (!data) return res.status(404).json({ error: 'todos.json no encontrado', total: 0, rows: [] });
        const q = { year: req.query.year || '', mes: req.query.mes || '', zona: req.query.zona || '', tipo: req.query.tipo || '', containerType: req.query.containerType || '', matricula: req.query.matricula || '' };
        const page    = Math.max(0, parseInt(req.query.page    || '0',  10));
        const perPage = Math.min(500, Math.max(1, parseInt(req.query.perPage || '150', 10)));
        const rows  = filterCamion(data, q);
        const total = rows.length;
        const slice = rows.slice(page * perPage, (page + 1) * perPage);
        res.json({ total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)), rows: slice });
    } catch (e) {
        res.status(500).json({ error: e.message, total: 0, rows: [] });
    }
});

/** Valores únicos para los filtros del camión (zona, tipo, containerType). */
app.get('/api/residuos/camion/filtros', (req, res) => {
    try {
        const data = loadCamionCache();
        if (!data) return res.status(404).json({ error: 'todos.json no encontrado' });
        const zonas = new Set(), tipos = new Set(), containers = new Set();
        data.forEach((r) => {
            if (r.zona)          zonas.add(r.zona);
            if (r.tipo || r.garbage) tipos.add(r.tipo || r.garbage);
            if (r.containerType) containers.add(r.containerType);
        });
        res.json({
            zonas:          [...zonas].sort(),
            tipos:          [...tipos].sort(),
            containerTypes: [...containers].sort()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Agrega todos los datos necesarios para generar el informe de un mes.
 *  GET /api/residuos/informe-data?mes=2025-08
 */
app.get('/api/residuos/informe-data', (req, res) => {
    try {
        const mes = (req.query.mes || '').trim();
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Parámetro mes requerido (YYYY-MM)' });

        const camion = loadCamionCache();
        if (!camion) return res.status(404).json({ error: 'todos.json no encontrado' });

        // Pesajes desde resumen.json
        let pesajesData = [];
        try {
            const rp = path.join(__dirname, 'data', 'RESIDUOS', 'resumen.json');
            if (fs.existsSync(rp)) pesajesData = JSON.parse(fs.readFileSync(rp, 'utf8')).pesajes || [];
        } catch (_) {}

        const [anio, mesNum] = mes.split('-').map(Number);
        const mesPrev = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, '0')}`;
        const mesAnioAnterior = `${anio - 1}-${String(mesNum).padStart(2, '0')}`;

        const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const labelMes = (m) => { if (!m) return ''; const [a, mo] = m.split('-'); return `${MESES_ES[parseInt(mo)-1]} ${a}`; };

        const agrupar = (rows, key, valKey) => {
            const m = {};
            rows.forEach((r) => { const k = r[key] || '—'; m[k] = (m[k] || 0) + (r[valKey] || 0); });
            return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };

        const rowsMes      = camion.filter((r) => r.fecha === mes);
        const rowsPrev     = camion.filter((r) => r.fecha === mesPrev);
        const rowsAnioAnt  = camion.filter((r) => r.fecha === mesAnioAnterior);

        const kgCamion      = rowsMes.reduce((s, r) => s + (r.kg || 0), 0);
        const salidasMes    = rowsMes.length;
        const kgPrev        = rowsPrev.reduce((s, r) => s + (r.kg || 0), 0);
        const salPrev       = rowsPrev.length;
        const kgAnioAnt     = rowsAnioAnt.reduce((s, r) => s + (r.kg || 0), 0);
        const salAnioAnt    = rowsAnioAnt.length;

        const kgExcel = pesajesData.filter((r) => r.fecha === mes).reduce((s, r) => s + (r.kg || 0), 0);

        const hoteles    = agrupar(rowsMes, 'establecimiento', 'kg');
        const zonas      = agrupar(rowsMes, 'zona',            'kg');
        const tipos      = agrupar(rowsMes, 'tipo',            'kg');
        const contenedores = agrupar(rowsMes, 'containerType', 'kg');
        const matriculas = agrupar(rowsMes, 'matricula',       'kg');

        const pct = (a, b) => b > 0 ? ((a - b) / b * 100) : null;
        const kgHoteles = hoteles.filter(([h]) => h && h !== '—' && h !== 'Peñiscola RSU').reduce((s, [, k]) => s + k, 0);
        const pctHoteles = kgCamion > 0 ? (kgHoteles / kgCamion * 100).toFixed(1) : '0';

        res.json({
            periodo:      mes,
            periodoLabel: labelMes(mes),
            kgCamion, kgExcel,
            salidas: salidasMes,
            hoteles:     hoteles.slice(0, 15),
            zonas:       zonas.slice(0, 12),
            tipos:       tipos.slice(0, 10),
            contenedores: contenedores.slice(0, 12),
            matriculas:  matriculas.slice(0, 8),
            pctResiduosHoteles: pctHoteles,
            comparacionMesAnterior: {
                periodo: labelMes(mesPrev), mes: mesPrev,
                kgCamion: kgPrev, salidas: salPrev,
                diffCamion: pct(kgCamion, kgPrev), diffSalidas: pct(salidasMes, salPrev)
            },
            comparacionAnioAnterior: {
                periodo: labelMes(mesAnioAnterior), mes: mesAnioAnterior,
                kgCamion: kgAnioAnt, salidas: salAnioAnt,
                diffCamion: pct(kgCamion, kgAnioAnt), diffSalidas: pct(salidasMes, salAnioAnt)
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Genera y descarga directamente el informe Word de un mes.
 *  GET /api/residuos/descargar-informe?mes=2025-08
 */
app.get('/api/residuos/descargar-informe', async (req, res) => {
    try {
        const mes = (req.query.mes || '').trim();
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
            return res.status(400).json({ error: 'Parámetro mes requerido (YYYY-MM)' });
        }

        const camion = loadCamionCache();
        if (!camion) return res.status(404).json({ error: 'todos.json no encontrado' });

        // Pesajes desde resumen.json
        let pesajesData = [];
        try {
            const rp = path.join(__dirname, 'data', 'RESIDUOS', 'resumen.json');
            if (fs.existsSync(rp)) pesajesData = JSON.parse(fs.readFileSync(rp, 'utf8')).pesajes || [];
        } catch (_) {}

        const [anio, mesNum] = mes.split('-').map(Number);
        const mesPrev         = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, '0')}`;
        const mesAnioAnterior = `${anio - 1}-${String(mesNum).padStart(2, '0')}`;
        const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const labelMes = (m) => { if (!m) return ''; const [a, mo] = m.split('-'); return `${MESES_ES[parseInt(mo)-1]} ${a}`; };

        const agrupar = (rows, key, valKey) => {
            const map = {};
            rows.forEach((r) => { const k = r[key] || '—'; map[k] = (map[k] || 0) + (r[valKey] || 0); });
            return Object.entries(map).sort((a, b) => b[1] - a[1]);
        };

        const rowsMes     = camion.filter((r) => r.fecha === mes);
        const rowsPrev    = camion.filter((r) => r.fecha === mesPrev);
        const rowsAnioAnt = camion.filter((r) => r.fecha === mesAnioAnterior);

        const kgCamion   = rowsMes.reduce((s, r)  => s + (r.kg || 0), 0);
        const salidasMes = rowsMes.length;
        const kgPrev     = rowsPrev.reduce((s, r)  => s + (r.kg || 0), 0);
        const salPrev    = rowsPrev.length;
        const kgAnioAnt  = rowsAnioAnt.reduce((s, r) => s + (r.kg || 0), 0);
        const salAnioAnt = rowsAnioAnt.length;
        const kgExcel    = pesajesData.filter((r) => r.fecha === mes).reduce((s, r) => s + (r.kg || 0), 0);

        const hoteles     = agrupar(rowsMes, 'establecimiento', 'kg');
        const zonas       = agrupar(rowsMes, 'zona',            'kg');
        const tipos       = agrupar(rowsMes, 'tipo',            'kg');
        const contenedores = agrupar(rowsMes, 'containerType',  'kg');
        const matriculas  = agrupar(rowsMes, 'matricula',       'kg');

        const pct = (a, b) => b > 0 ? parseFloat(((a - b) / b * 100).toFixed(2)) : null;
        const kgHoteles  = hoteles.filter(([h]) => h && h !== '—' && h !== 'Peñiscola RSU').reduce((s, [, k]) => s + k, 0);
        const pctHoteles = kgCamion > 0 ? (kgHoteles / kgCamion * 100).toFixed(1) : '0';

        const informeData = {
            periodo:      mes,
            periodoLabel: labelMes(mes),
            kgCamion, kgExcel,
            salidas:      salidasMes,
            hoteles:      hoteles.slice(0, 15),
            zonas:        zonas.slice(0, 12),
            tipos:        tipos.slice(0, 10),
            contenedores: contenedores.slice(0, 12),
            matriculas:   matriculas.slice(0, 8),
            pctResiduosHoteles: pctHoteles,
            comparacionMesAnterior: {
                periodo: labelMes(mesPrev), mes: mesPrev,
                kgCamion: kgPrev, salidas: salPrev,
                diffCamion: pct(kgCamion, kgPrev), diffSalidas: pct(salidasMes, salPrev)
            },
            comparacionAnioAnterior: {
                periodo: labelMes(mesAnioAnterior), mes: mesAnioAnterior,
                kgCamion: kgAnioAnt, salidas: salAnioAnt,
                diffCamion: pct(kgCamion, kgAnioAnt), diffSalidas: pct(salidasMes, salAnioAnt)
            }
        };

        const buf    = await generarDocx(informeData);
        const nombre = `Informe_Residuos_${(informeData.periodoLabel || mes).replace(/\s+/g, '_')}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
        res.send(Buffer.from(buf));
    } catch (e) {
        console.error('Error generando informe:', e);
        res.status(500).json({ error: e.message || 'Error al generar el informe' });
    }
});

app.get('/data/RESIDUOS/camion/mapa.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'mapa.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/camion/mapa_sample.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'mapa_sample.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/zonas_peniscola.geojson', (req, res) => {
    const p = path.join(__dirname, 'data', 'zonas_peniscola.geojson');
    if (fs.existsSync(p)) {
        res.type('application/geo+json');
        res.sendFile(p);
    } else res.status(404).json({ error: 'Archivo no encontrado' });
});

// Archivos estáticos (css, js, data, etc.)
app.use(express.static(path.join(__dirname)));

app.post('/api/chat', chatLimiter, async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY no configurada en .env' });
    }
    const { message, history, context } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Falta el mensaje' });
    }
    const systemPrompt = `Eres un asistente del dashboard de residuos de Peñíscola (España). Responde en español de forma breve y útil. Usa estos datos del dashboard para responder:\n\n${context || 'Sin contexto'}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        ...(history || []).slice(-10).map(m => ({ role: m.isBot ? 'assistant' : 'user', content: m.text })),
        { role: 'user', content: message }
    ];
    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });
        const data = await r.json();
        if (!r.ok) {
            throw new Error(data.error?.message || r.statusText || 'Error API');
        }
        const text = data.choices?.[0]?.message?.content?.trim() || 'No hubo respuesta.';
        res.json({ reply: text });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al conectar con OpenAI' });
    }
});

const PLANTILLA_PATH = path.join(EJEMPLOS_DIR, 'plantilla_informe.txt');

function generarInformeDesdePlantilla(data) {
    const plantilla = fs.existsSync(PLANTILLA_PATH) ? fs.readFileSync(PLANTILLA_PATH, 'utf8') : null;
    if (!plantilla) return null;
    const fmt = (n) => (n ?? 0).toLocaleString('es-ES');
    const fmtPct = (n) => (n != null ? n.toFixed(2).replace('.', ',') + '%' : '--');
    const periodoLabel = data.periodoLabel || data.periodo || '--';
    const comp = data.comparacionPeriodoAnterior || {};
    const diffCamion = comp.diffCamion != null ? fmtPct(comp.diffCamion) : '--';
    const diffSalidas = comp.diffSalidas != null ? fmtPct(comp.diffSalidas) : '--';
    const totalKg = (data.kgCamion || 0) + (data.kgExcel || 0);
    const pctHoteles = data.pctResiduosHoteles != null ? fmtPct(parseFloat(data.pctResiduosHoteles)) : '--';

    const zonas = (data.zonas || []).map(([z, k]) => `- ${z}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const contenedores = (data.contenedores || []).map(([c, k]) => `- ${c}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const hoteles = (data.hoteles || []).map(([h, k]) => `- ${h}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const tipos = (data.tipos || []).map(([t, k]) => `- ${t}: ${fmt(k)} kg`).join('\n') || '- Sin datos';

    const topHoteles = (data.hoteles || []).slice(0, 4).map(([h]) => h).join(', ');
    const conclusiones = `Se han recogido un total de ${fmt(data.kgCamion)} kg de residuos (camión RFID) en ${periodoLabel}, con ${data.salidas || 0} salidas registradas.${comp.periodo ? ` Variación respecto a ${comp.periodo}: ${diffCamion} en kg, ${diffSalidas} en salidas.` : ''}${topHoteles ? ` Principales generadores: ${topHoteles}.` : ''}`;

    return plantilla
        .replace(/\{\{MES_AÑO\}\}/g, periodoLabel.toUpperCase())
        .replace(/\{\{TOTAL_KG\}\}/g, fmt(totalKg))
        .replace(/\{\{SALIDAS\}\}/g, fmt(data.salidas))
        .replace(/\{\{PERIODO_ANTERIOR\}\}/g, comp.periodo || '--')
        .replace(/\{\{DIF_CAMION\}\}/g, diffCamion)
        .replace(/\{\{DIF_SALIDAS\}\}/g, diffSalidas)
        .replace(/\{\{PCT_HOTELES\}\}/g, pctHoteles)
        .replace(/\{\{ZONAS\}\}/g, zonas)
        .replace(/\{\{CONTENEDORES\}\}/g, contenedores)
        .replace(/\{\{HOTELES\}\}/g, hoteles)
        .replace(/\{\{TIPOS\}\}/g, tipos)
        .replace(/\{\{CONCLUSIONES\}\}/g, conclusiones);
}

async function analizarConChatGPT(apiKey, data) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: 'Eres un analista de residuos para el Ayuntamiento de Peñíscola. Analiza los datos y escribe un informe en español: compara con mes anterior y año anterior, destaca tendencias, principales generadores, zonas con más residuos. Usa ÚNICAMENTE los datos proporcionados. Formato: párrafos claros, números con formato español (455.380 kg, -49,01%). Máximo 600 palabras.'
            }, {
                role: 'user',
                content: `Analiza estos datos de residuos y escribe un informe comparativo:\n${JSON.stringify(data, null, 2)}`
            }],
            max_tokens: 1500,
            temperature: 0.5
        })
    });
    const resp = await r.json();
    if (!r.ok) throw new Error(resp.error?.message || r.statusText);
    return resp.choices?.[0]?.message?.content?.trim() || '';
}

function generarHTMLInforme(data, analisisChatGPT) {
    const fmt = (n) => (n ?? 0).toLocaleString('es-ES');
    const zonas = data.zonas || [];
    const tipos = (data.tipos || []).slice(0, 10);
    const hoteles = (data.hoteles || []).slice(0, 10);
    const comp = data.comparacionPeriodoAnterior || {};
    const compMes = data.comparacionMesAnterior || {};
    const itemsComp = [
        [data.periodoLabel, data.kgCamion, data.salidas],
        [compMes.periodo, compMes.kgCamion, compMes.salidas],
        [comp.periodo, comp.kgCamion, comp.salidas]
    ].filter(([l, k]) => l && k != null);
    const labelsComp = itemsComp.map(([l]) => l);
    const kgComp = itemsComp.map(([, k]) => k);
    const salidasComp = itemsComp.map(([, , s]) => s);
    const zonasData = JSON.stringify(zonas.slice(0, 10).map(([z, k]) => ({ z, k })));
    const tiposData = JSON.stringify(tipos.map(([t, k]) => ({ t, k })));
    const hotelesData = JSON.stringify(hoteles.map(([h, k]) => ({ h: h.length > 25 ? h.slice(0, 22) + '...' : h, k })));
    const compData = JSON.stringify({ labels: labelsComp, kg: kgComp, salidas: salidasComp });
    const analisis = (analisisChatGPT || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe Residuos ${data.periodoLabel || ''}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:2rem;background:#1a2332;color:#e6edf3;line-height:1.6;}
h1,h2{color:#00c9a7;}h2{margin-top:2rem;}
.chart-box{background:#0f1419;border-radius:8px;padding:1rem;margin:1rem 0;height:280px;}
.analisis{background:#0f1419;padding:1.5rem;border-radius:8px;margin:1rem 0;border-left:4px solid #00c9a7;}
table{width:100%;border-collapse:collapse;margin:1rem 0;}
th,td{padding:0.5rem;text-align:left;border-bottom:1px solid #30363d;}
th{color:#8b949e;}
</style>
</head>
<body>
<h1>INFORME RESIDUOS ${(data.periodoLabel || '').toUpperCase()}</h1>

<div class="analisis">
<h2>Análisis comparativo (ChatGPT)</h2>
<div>${analisis || 'Sin análisis disponible.'}</div>
</div>

<h2>Comparación: Kg y salidas</h2>
<div class="chart-box"><canvas id="chartComp"></canvas></div>

<h2>Residuos por zona (top 10)</h2>
<div class="chart-box"><canvas id="chartZonas"></canvas></div>

<h2>Tipos de residuo</h2>
<div class="chart-box"><canvas id="chartTipos"></canvas></div>

<h2>Hoteles y campings (top 10)</h2>
<div class="chart-box"><canvas id="chartHoteles"></canvas></div>

<h2>Datos por zona</h2>
<table><thead><tr><th>Zona</th><th>Kg</th></tr></thead><tbody>
${zonas.map(([z, k]) => `<tr><td>${z}</td><td>${fmt(k)}</td></tr>`).join('')}
</tbody></table>

<h2>Datos por tipo de contenedor</h2>
<table><thead><tr><th>Contenedor</th><th>Kg</th></tr></thead><tbody>
${(data.contenedores || []).map(([c, k]) => `<tr><td>${c}</td><td>${fmt(k)}</td></tr>`).join('')}
</tbody></table>

<script>
const opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8b949e'}}},scales:{x:{ticks:{color:'#8b949e'},grid:{color:'#30363d'}},y:{ticks:{color:'#8b949e'},grid:{color:'#30363d'}}}};
const comp=${compData};
if(comp.labels.length&&comp.kg.length){
new Chart(document.getElementById('chartComp'),{type:'bar',data:{labels:comp.labels,datasets:[{label:'Kg',data:comp.kg,backgroundColor:'#00c9a7'},{label:'Salidas',data:comp.salidas,backgroundColor:'#7c3aed',yAxisID:'y1'}]},options:{...opts,scales:{...opts.scales,y:{...opts.scales.y},y1:{type:'linear',position:'right',ticks:{color:'#8b949e'},grid:{display:false}}}}});
}
const zonas=${zonasData};
if(zonas.length){new Chart(document.getElementById('chartZonas'),{type:'bar',data:{labels:zonas.map(x=>x.z),datasets:[{label:'Kg',data:zonas.map(x=>x.k),backgroundColor:'#00c9a7'}]},options:opts});}
const tipos=${tiposData};
if(tipos.length){new Chart(document.getElementById('chartTipos'),{type:'doughnut',data:{labels:tipos.map(x=>x.t),datasets:[{data:tipos.map(x=>x.k),backgroundColor:['#00c9a7','#7c3aed','#f59e0b','#ef4444','#3b82f6','#ec4899','#10b981','#6366f1','#14b8a6','#a855f7']}]},options:{...opts,scales:{}}});}
const hoteles=${hotelesData};
if(hoteles.length){new Chart(document.getElementById('chartHoteles'),{type:'bar',data:{labels:hoteles.map(x=>x.h),datasets:[{label:'Kg',data:hoteles.map(x=>x.k),backgroundColor:'#7c3aed'}]},options:{...opts}});}
</script>
</body>
</html>`;
}

const { generarDocx, getRutaPortada } = require('./generadorWord');

// Procesar archivos CSV/Excel de cámaras (lee data/camaras/entrada/, escribe todos.json)
app.post('/api/process-camaras', (req, res) => {
    try {
        const { execSync } = require('child_process');
        execSync('node procesar_camaras.js', { cwd: __dirname, stdio: 'pipe' });
        res.json({ ok: true, message: 'Archivos procesados' });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Error al procesar' });
    }
});

app.post('/api/export-word', async (req, res) => {
    const { data } = req.body || {};
    if (!data) {
        return res.status(400).json({ error: 'Faltan datos del informe' });
    }
    try {
        const buf = await generarDocx(data);
        const nombre = `Informe_Residuos_${(data.periodoLabel || 'informe').replace(/\s+/g, '_')}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
        res.send(Buffer.from(buf));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al generar Word' });
    }
});

app.post('/api/generate-report', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const { periodo, periodoLabel, data } = req.body || {};
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Faltan los datos del informe' });
    }
    try {
        let analisis = '';
        if (apiKey) {
            try {
                analisis = await analizarConChatGPT(apiKey, data);
            } catch (e) {
                console.warn('ChatGPT análisis:', e.message);
            }
        }
        const html = generarHTMLInforme(data, analisis);
        const report = generarInformeDesdePlantilla(data);
        res.json({ report, html, analisis });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al generar el informe' });
    }
});

// Al arrancar: procesar cámaras en segundo plano para que los datos estén ya listos
function asegurarDatosCamaras() {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['procesar_camaras.js'], { cwd: __dirname, stdio: 'ignore' });
    proc.on('close', (code) => {
        if (code === 0) console.log('Cámaras: datos procesados.');
        else console.warn('Cámaras: procesamiento finalizado con código', code);
    });
    proc.on('error', (e) => console.warn('Cámaras:', e.message));
}

// Al arrancar: descarga inicial si los datos del INE son más antiguos que TURISMO_REFRESH_HORAS.
// Por defecto 3 semanas (504 h) — el usuario también puede forzar el refresco con el botón "Actualizar INE".
const TURISMO_REFRESH_HORAS = parseFloat(process.env.TURISMO_REFRESH_HORAS || '504');
function asegurarDatosTurismo() {
    const p = path.join(__dirname, 'data', 'TURISMO', 'todos.json');
    const existe = fs.existsSync(p);
    const mtime = existe ? fs.statSync(p).mtime.getTime() : 0;
    const horasDesde = (Date.now() - mtime) / 3600000;
    if (!existe || horasDesde > TURISMO_REFRESH_HORAS) {
        console.log(`[turismo] Comprobando datos INE (${existe ? `última actualización hace ${horasDesde.toFixed(1)}h` : 'sin descargar'})…`);
        ejecutarDescargaTurismo().catch((e) => console.warn('[turismo] Descarga inicial:', e.message));
    } else {
        console.log(`[turismo] Datos INE recientes (hace ${horasDesde.toFixed(1)}h). No se redescarga.`);
    }
}

app.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    asegurarDatosCamaras();
    asegurarDatosTurismo();
});
