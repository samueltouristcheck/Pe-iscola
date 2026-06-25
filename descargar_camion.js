/**
 * Descarga las recogidas del camión (API Distromel/Sigeus) de un mes y las
 * fusiona en el fichero anual data/RESIDUOS/camion/JSON/<año>/Residus_<año>.json.
 *
 * Reemplaza el procedimiento manual de Postman: misma petición
 * (ServiceRsu GetCollectionsBetweenDates) con las credenciales del .env.
 *
 * Uso:
 *   node descargar_camion.js              (mes anterior)
 *   node descargar_camion.js 2026-04      (un mes concreto)
 *
 * Es idempotente: si vuelves a ejecutar el mismo mes, sustituye sus registros
 * (no duplica). Tras descargar, ejecuta `npm run preparar-residuos` para
 * regenerar data/RESIDUOS/camion/todos.json que lee el dashboard.
 */
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const BASE = process.env.SIGEUS_BASE || 'https://www.sigeus.net/wsext/3.4';
const USER = process.env.SIGEUS_BASIC_USER || '';
const PASS = process.env.SIGEUS_BASIC_PASS || '';
const IDENTITY_KEY = process.env.SIGEUS_IDENTITY_KEY || '';

function mesObjetivo() {
    const arg = process.argv[2];
    if (arg && /^\d{4}-\d{2}$/.test(arg)) return arg;
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function descargarMes(mes) {
    if (!USER || !PASS || !IDENTITY_KEY) {
        throw new Error('Faltan credenciales SIGEUS_* en .env');
    }
    const [anio, mm] = mes.split('-');
    const ultimoDia = new Date(Number(anio), Number(mm), 0).getDate();
    const startDateUtc = `${anio}${mm}01000000`;
    const endDateUtc = `${anio}${mm}${String(ultimoDia).padStart(2, '0')}235959`;

    const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
    const body = { startDateUtc, endDateUtc, garbage: '', resourceIds: [], province: '', municipality: '', address: '' };

    console.log(`⏳ Descargando recogidas ${mes} (${startDateUtc} – ${endDateUtc})…`);
    const r = await fetch(`${BASE}/ServiceRsu.svc/ssl/GetCollectionsBetweenDates`, {
        method: 'POST',
        headers: { Authorization: auth, IDENTITY_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`API Sigeus HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const registros = await r.json();
    if (!Array.isArray(registros)) throw new Error('La API no devolvió un array');
    console.log(`✅ ${registros.length.toLocaleString('es-ES')} registros recibidos.`);
    return registros;
}

function fusionarEnAnio(mes, registros) {
    const [anio, mm] = mes.split('-');
    const ymKey = `${anio}${mm}`;
    const dir = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'JSON', anio);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `Residus_${anio}.json`);

    let existentes = [];
    if (fs.existsSync(file)) {
        try { existentes = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { existentes = []; }
        if (!Array.isArray(existentes)) existentes = [];
    }
    const antes = existentes.length;
    // Quita los registros del mismo mes (para no duplicar al reejecutar) y añade los nuevos.
    const sinEsteMes = existentes.filter((x) => String(x.FullDateUtc).slice(0, 6) !== ymKey);
    const quitados = antes - sinEsteMes.length;
    const fusion = sinEsteMes.concat(registros);
    fusion.sort((a, b) => String(a.FullDateUtc).localeCompare(String(b.FullDateUtc)));

    fs.writeFileSync(file, JSON.stringify(fusion));
    console.log(`💾 ${path.relative(__dirname, file)}: ${antes.toLocaleString('es-ES')} → ${fusion.length.toLocaleString('es-ES')} registros (mes ${ymKey}: quitados ${quitados}, añadidos ${registros.length}).`);
    return file;
}

async function main() {
    const mes = mesObjetivo();
    const registros = await descargarMes(mes);
    if (registros.length === 0) {
        console.warn(`⚠️  0 registros para ${mes}. No se modifica el fichero anual.`);
        return;
    }
    fusionarEnAnio(mes, registros);
    console.log('\n➡️  Para que el dashboard lo refleje, regenera el resumen:');
    console.log('    npm run preparar-residuos   (o: python preparar_datos.py)');
}

if (require.main === module) {
    main().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
}

module.exports = { descargarMes, fusionarEnAnio, mesObjetivo };
