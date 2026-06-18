/**
 * Orquestador de informes mensuales del dashboard de Peñíscola.
 * Genera 3 informes Word (.docx) del mes indicado (o del mes anterior por defecto):
 *   - Residuos  (reutiliza generarInformesResiduous.js)
 *   - Turismo   (datos INE de data/TURISMO/todos.json)
 *   - Redes/Web (Meta manual + Google Analytics en directo, vía redes.js)
 *
 * Uso:
 *   node generar_informes_mensuales.js            (mes anterior)
 *   node generar_informes_mensuales.js 2026-04    (un mes concreto)
 *
 * Salida: informes_generados/AAAA_MM_Informe_<Apartado>_<Mes>_<Año>.docx
 */
'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Footer, PageNumber, Table, TableRow, TableCell, WidthType
} = require('docx');

const OUT_DIR = path.join(__dirname, 'informes_generados');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const COLOR_AZUL = '1B3A6B', COLOR_VERDE = '2D6A4F', COLOR_MORADO = '6D28D9';

/* ── helpers de formato ── */
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('es-ES');
const eur = (n) => (n == null ? '—' : Number(n).toFixed(2).replace('.', ',') + ' €');
const pct = (n) => (n == null ? '—' : Number(n).toFixed(1).replace('.', ',') + ' %');
const labelMes = (m) => { const [a, mo] = m.split('-'); return `${MESES_ES[parseInt(mo, 10) - 1]} ${a}`; };
const nombreArchivo = (mes, apartado) => `${mes.replace('-', '_')}_Informe_${apartado}_${labelMes(mes).replace(/\s+/g, '_')}.docx`;

/* ── helpers docx ── */
const t = (x, o = {}) => new TextRun({ text: String(x == null ? '' : x), size: 22, ...o });
const b = (x, o = {}) => new TextRun({ text: String(x == null ? '' : x), size: 22, bold: true, ...o });
const p = (ch, o = {}) => new Paragraph({ spacing: { after: 160, line: 280 }, children: ch, ...o });
const bullet = (runs) => new Paragraph({ spacing: { after: 80 }, indent: { left: 360, hanging: 200 }, children: [new TextRun({ text: '• ', size: 22, bold: true }), ...runs] });
function heading(text, color = COLOR_AZUL, size = 28) {
    return new Paragraph({ spacing: { before: 320, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 4 } }, children: [new TextRun({ text, bold: true, size, color })] });
}
function titulo(text, color = COLOR_AZUL) {
    return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 }, children: [new TextRun({ text, bold: true, size: 40, color })] });
}
function subtitulo(text) {
    return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text, size: 24, color: '555555' })] });
}
function tablaKpi(rows) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(([l, v]) => new TableRow({
            children: [
                new TableCell({ width: { size: 62, type: WidthType.PERCENTAGE }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [p([t(l)], { spacing: { after: 0 } })] }),
                new TableCell({ width: { size: 38, type: WidthType.PERCENTAGE }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [p([b(v)], { spacing: { after: 0 } })] })
            ]
        }))
    });
}
function documento(children, footerText) {
    return new Document({
        sections: [{
            properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
            footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: footerText + ' · pág. ', size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' })] })] }) },
            children
        }]
    });
}

/* ── utilidades de datos de turismo ── */
function valorMes(catSeries, mes, filtro) {
    let total = 0, hay = false;
    (catSeries || [])
        .filter((s) => (!filtro.metrica || s.metrica === filtro.metrica) && (!filtro.residencia || s.residencia === filtro.residencia))
        .forEach((s) => (s.data || []).forEach((d) => { if (d.fecha === mes) { total += d.valor; hay = true; } }));
    return hay ? total : null;
}

/* ── INFORME TURISMO ── */
function construirInformeTurismo(mes) {
    const file = path.join(__dirname, 'data', 'TURISMO', 'todos.json');
    if (!fs.existsSync(file)) throw new Error('No existe data/TURISMO/todos.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const S = data.series || {};
    const lab = labelMes(mes);

    const h = {
        viajeros: valorMes(S.hoteles, mes, { metrica: 'viajeros' }),
        pernoct: valorMes(S.hoteles, mes, { metrica: 'pernoctaciones' }),
        estancia: valorMes(S.hoteles, mes, { metrica: 'estancia_media' }),
        ocupacion: valorMes(S.hoteles, mes, { metrica: 'grado_ocupacion' }),
        plazas: valorMes(S.hoteles, mes, { metrica: 'plazas' }),
        adr: valorMes(S.hoteles, mes, { metrica: 'adr' }),
        revpar: valorMes(S.hoteles, mes, { metrica: 'revpar' }),
        personal: valorMes(S.hoteles, mes, { metrica: 'personal_empleado' })
    };
    const c = {
        viajeros: valorMes(S.campings, mes, { metrica: 'viajeros' }),
        pernoct: valorMes(S.campings, mes, { metrica: 'pernoctaciones' }),
        ocupacion: valorMes(S.campings, mes, { metrica: 'grado_ocupacion' }),
        plazas: valorMes(S.campings, mes, { metrica: 'plazas' })
    };
    const movil = valorMes(S.movilidad, mes, { metrica: 'turistas', residencia: 'total' });

    const ch = [];
    ch.push(titulo('Informe de Turismo'));
    ch.push(subtitulo('Peñíscola · ' + lab + ' · Fuente: INE'));
    ch.push(p([t('Resumen del rendimiento turístico de Peñíscola en '), b(lab), t(' a partir de las estadísticas oficiales del Instituto Nacional de Estadística (Encuesta de Ocupación Hotelera, Campings y movilidad turística).')]));

    ch.push(heading('Hoteles'));
    if (h.viajeros == null && h.pernoct == null) {
        ch.push(p([t('El INE aún no ha publicado datos hoteleros para este mes.')]));
    } else {
        ch.push(tablaKpi([
            ['Viajeros alojados', fmt(h.viajeros)],
            ['Pernoctaciones', fmt(h.pernoct)],
            ['Estancia media (días)', h.estancia != null ? h.estancia.toFixed(2).replace('.', ',') : '—'],
            ['Grado de ocupación por plazas', pct(h.ocupacion)],
            ['Plazas estimadas', fmt(h.plazas)],
            ['Tarifa media diaria (ADR)', eur(h.adr)],
            ['Ingreso por habitación disponible (RevPAR)', eur(h.revpar)],
            ['Personal empleado', fmt(h.personal)]
        ]));
    }

    ch.push(heading('Campings', COLOR_VERDE));
    if (c.viajeros == null && c.pernoct == null) {
        ch.push(p([t('Sin datos de campings publicados para este mes.')]));
    } else {
        ch.push(tablaKpi([
            ['Viajeros alojados', fmt(c.viajeros)],
            ['Pernoctaciones', fmt(c.pernoct)],
            ['Grado de ocupación', pct(c.ocupacion)],
            ['Plazas', fmt(c.plazas)]
        ]));
    }

    ch.push(heading('Movilidad turística (INE móvil)', COLOR_MORADO));
    ch.push(p([t('Turistas extranjeros estimados en el municipio (datos de operadoras móviles): '), b(movil != null ? fmt(movil) : 'sin publicar para este mes'), t('.')]));
    if (data.resumen && data.resumen.presionTuristica) {
        const pr = data.resumen.presionTuristica;
        const pctPres = pr.habitantes ? (pr.turistas / pr.habitantes * 100) : null;
        ch.push(bullet([t('Presión turística (último dato): '), b(pct(pctPres)), t(' (turistas extranjeros del mes ÷ habitantes).')]));
    }

    ch.push(p([t('Datos generados automáticamente desde el dashboard de Peñíscola. Fuente: INE.', { italics: true, color: '888888', size: 18 })], { spacing: { before: 320 } }));
    return documento(ch, 'Informe de Turismo · ' + lab);
}

/* ── INFORME REDES / WEB ── */
function construirInformeRedes(overview, mes) {
    const lab = labelMes(mes);
    const meta = overview.meta || {};
    const fb = meta.facebook || {};
    const ig = meta.instagram || {};
    const aud = meta.audiencia || null;
    const ga = overview.ga || {};

    const ch = [];
    ch.push(titulo('Informe de Redes y Web', COLOR_MORADO));
    ch.push(subtitulo('Peñíscola · ' + lab));
    ch.push(p([t('Resumen de la presencia digital de Peñíscola: redes sociales (Meta) y tráfico web (Google Analytics). Las cifras de redes corresponden a los últimos 28-30 días disponibles; las de la web, a los últimos 30 días.')]));

    ch.push(heading('Facebook'));
    ch.push(tablaKpi([
        ['Seguidores', fmt(fb.followers)],
        ['Alcance (30 d)', fmt(fb.reach)],
        ['Visualizaciones (30 d)', fmt(fb.impressions)],
        ['Interacciones (30 d)', fmt(fb.engagement)],
        ['Visitas (30 d)', fmt(fb.visitas)]
    ]));

    ch.push(heading('Instagram', 'D6249F'));
    ch.push(tablaKpi([
        ['Seguidores', fmt(ig.followers)],
        ['Alcance (30 d)', fmt(ig.reach)],
        ['Visualizaciones (30 d)', fmt(ig.impressions)],
        ['Interacciones (30 d)', fmt(ig.engagement)]
    ]));

    if (aud) {
        ch.push(heading('Audiencia (Facebook)', COLOR_AZUL));
        ch.push(bullet([t('Sexo: '), b(pct(aud.mujeres) + ' mujeres'), t(' · '), b(pct(aud.hombres) + ' hombres'), t('.')]));
        if (aud.edadPrincipal) ch.push(bullet([t('Franja de edad principal: '), b(aud.edadPrincipal), t('.')]));
        if (aud.topCiudad) ch.push(bullet([t('Ciudad principal: '), b(aud.topCiudad), t('.')]));
        if (aud.topPais) ch.push(bullet([t('País principal: '), b(aud.topPais), t('.')]));
    }

    ch.push(heading('Web — Google Analytics', COLOR_VERDE));
    if (ga.configured && ga.sessions != null) {
        ch.push(tablaKpi([
            ['Sesiones (30 d)', fmt(ga.sessions)],
            ['Usuarios (30 d)', fmt(ga.users)],
            ['Páginas vistas (30 d)', fmt(ga.pageviews)],
            ['Duración media (s)', ga.avgDuration != null ? fmt(ga.avgDuration) : '—'],
            ['% rebote', ga.bounceRate != null ? pct(ga.bounceRate * 100) : '—']
        ]));
        if (Array.isArray(ga.topPages) && ga.topPages.length) {
            ch.push(p([b('Páginas más vistas:')], { spacing: { before: 120, after: 60 } }));
            ga.topPages.slice(0, 5).forEach((x) => ch.push(bullet([t(x.path + ' — '), b(fmt(x.views) + ' vistas')])));
        }
    } else {
        ch.push(p([t('Google Analytics no disponible en este momento' + (ga.error ? ' (' + ga.error + ')' : '') + '.')]));
    }

    ch.push(p([t('Datos de redes introducidos manualmente desde Meta Business Suite; web en directo desde Google Analytics. Generado automáticamente.', { italics: true, color: '888888', size: 18 })], { spacing: { before: 320 } }));
    return documento(ch, 'Informe de Redes y Web · ' + lab);
}

/* ── mes anterior (AAAA-MM) ── */
function mesAnterior() {
    const arg = process.argv[2];
    if (arg && /^\d{4}-\d{2}$/.test(arg)) return arg;
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
    const mes = mesAnterior();
    const lab = labelMes(mes);
    console.log(`\n📅 Generando informes mensuales de ${lab} (${mes})\n`);
    const creados = [];
    const errores = [];

    // 1) Residuos — reutiliza el generador existente
    try {
        console.log('— Residuos…');
        execFileSync('node', ['generarInformesResiduous.js', mes], { cwd: __dirname, stdio: 'inherit' });
        creados.push(nombreArchivo(mes, 'Residuos'));
    } catch (e) { errores.push('Residuos: ' + (e.message || e)); }

    // 2) Turismo
    try {
        console.log('— Turismo…');
        const buf = await Packer.toBuffer(construirInformeTurismo(mes));
        const nombre = nombreArchivo(mes, 'Turismo');
        fs.writeFileSync(path.join(OUT_DIR, nombre), buf);
        creados.push(nombre);
    } catch (e) { errores.push('Turismo: ' + (e.message || e)); }

    // 3) Redes / Web
    try {
        console.log('— Redes / Web…');
        const { getRedesOverview } = require('./redes');
        const overview = await getRedesOverview();
        const buf = await Packer.toBuffer(construirInformeRedes(overview, mes));
        const nombre = nombreArchivo(mes, 'Redes');
        fs.writeFileSync(path.join(OUT_DIR, nombre), buf);
        creados.push(nombre);
    } catch (e) { errores.push('Redes: ' + (e.message || e)); }

    console.log('\n──────────────────────────────────────');
    console.log(`✅ Informes de ${lab} generados en informes_generados/:`);
    creados.forEach((n) => console.log('   · ' + n));
    if (errores.length) { console.log('\n⚠️  No se pudieron generar:'); errores.forEach((e) => console.log('   · ' + e)); }
    console.log('──────────────────────────────────────\n');
}

if (require.main === module) {
    main().catch((e) => { console.error('❌ Error fatal:', e.message); process.exit(1); });
}

module.exports = { construirInformeTurismo, construirInformeRedes, mesAnterior };
