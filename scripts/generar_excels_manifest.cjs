/**
 * Genera data/RESIDUOS/pesajes/excels_manifest.json sin pandas.
 * Útil cuando preparar_datos.py no está disponible o solo quieres refrescar el listado.
 * Misma lógica que server.js (inferPesajesExcelMeta + walk).
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const PESAJES_ROOT = path.join(BASE, 'data', 'RESIDUOS', 'pesajes');
const OUT = path.join(PESAJES_ROOT, 'excels_manifest.json');

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

function main() {
    fs.mkdirSync(PESAJES_ROOT, { recursive: true });
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
    fs.writeFileSync(OUT, JSON.stringify({ files }, null, 2), 'utf8');
    console.log(`excels_manifest.json: ${files.length} archivo(s) -> ${path.relative(BASE, OUT)}`);
}

main();
