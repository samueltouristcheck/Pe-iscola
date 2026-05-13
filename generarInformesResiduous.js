/**
 * Genera los informes mensuales de residuos en formato Word (.docx)
 * Estilo: texto narrativo con números en negrita, igual que la plantilla real.
 * Uso: node generarInformesResiduous.js [mes1] [mes2] ...
 *      node generarInformesResiduous.js 2025-08 2025-09 2025-10
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, ImageRun,
    AlignmentType, PageBreak, HeadingLevel, ShadingType,
    Header, Footer, PageNumber, BorderStyle, WidthType,
    Table, TableRow, TableCell, VerticalAlign
} = require('docx');

// ── Config ───────────────────────────────────────────────────────────────
const OUT_DIR      = path.join(__dirname, 'informes_generados');
const PORTADA_PATH = (() => {
    for (const n of ['Imagen_portada.png','imagen_portada.png','portada.png','portada.jpg']) {
        const p = path.join(__dirname, 'informes_ejemplo', n);
        if (fs.existsSync(p)) return p;
    }
    return null;
})();

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const COLOR_AZUL  = '1B3A6B';
const COLOR_VERDE = '2D6A4F';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers de formato ────────────────────────────────────────────────────
const fmt     = (n) => Math.round(n ?? 0).toLocaleString('es-ES');
const fmtPct  = (n) => n != null ? (n > 0 ? '+' : '') + Math.abs(n).toFixed(2).replace('.', ',') + ' %' : '—';
const signo   = (n) => n >= 0 ? 'incremento' : 'descenso';
const labelMes = (m) => { if (!m) return ''; const [a, mo] = m.split('-'); return `${MESES_ES[parseInt(mo)-1]} ${a}`; };

// Crea un TextRun normal
const t = (text, opts = {}) => new TextRun({ text: String(text ?? ''), size: 22, ...opts });
// Crea un TextRun en negrita (para cifras clave)
const b = (text, opts = {}) => new TextRun({ text: String(text ?? ''), size: 22, bold: true, ...opts });
// Párrafo con varias runs mixtas
const p = (children, opts = {}) => new Paragraph({ spacing: { after: 160, line: 280 }, children, ...opts });

function heading(text, color = COLOR_AZUL, size = 28) {
    return new Paragraph({
        spacing: { before: 320, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: color, space: 4 } },
        children: [new TextRun({ text, bold: true, size, color })],
    });
}

function bulletItem(runs) {
    return new Paragraph({
        spacing: { after: 80 },
        indent: { left: 360, hanging: 200 },
        children: [new TextRun({ text: '• ', size: 22, bold: true }), ...runs],
    });
}

function spacer(lines = 1) {
    return new Paragraph({ spacing: { after: lines * 120 }, children: [] });
}

// ── Generador de contenido narrativo por mes ──────────────────────────────
function generarContenido(data) {
    const mes      = data.periodoLabel;       // "Agosto 2025"
    const mesLower = mes.toLowerCase();       // "agosto 2025"
    const mesNombre = mes.split(' ')[0];      // "Agosto"
    const mesNombreLower = mesNombre.toLowerCase(); // "agosto"

    const kgC  = data.kgCamion   || 0;
    const kgE  = data.kgExcel    || 0;
    const sal  = data.salidas     || 0;
    const pctH = parseFloat(data.pctResiduosHoteles || 0);

    const compMes  = data.comparacionMesAnterior  || {};
    const compAnio = data.comparacionAnioAnterior  || {};

    const hoteles    = (data.hoteles     || []).filter(([h]) => h !== '—' && h !== 'Peñiscola RSU' && h !== 'Peñiscola SEL PAP' && !h.startsWith('FONT') && !h.startsWith('SUBURBANO') && !h.startsWith('LLANDELLS') && !h.startsWith('ATALAYAS'));
    const zonas      = (data.zonas       || []).filter(([z]) => z !== '—' && !z.startsWith('HOTEL') && !z.startsWith('FUERA'));
    const tipos      = (data.tipos       || []).slice(0, 5);
    const contened   = (data.contenedores || []).slice(0, 6);

    const kgHotelesFiltrados = hoteles.reduce((s, [, k]) => s + k, 0);
    const topHotel1 = hoteles[0];
    const topHotel2 = hoteles[1];
    const topHotel3 = hoteles[2];

    const topCont1  = contened[0];
    const topCont2  = contened[1];
    const contHotel = contened.find(([c]) => c.includes('HOTEL'));

    const diffMesKg     = compMes.diffCamion;
    const diffAnioKg    = compAnio.diffCamion;
    const diffMesSal    = compMes.diffSalidas;

    const periodoAnt  = compMes.periodo   || '';   // "Julio 2025"
    const periodoAnio = compAnio.periodo  || '';   // "Agosto 2024"

    const children = [];

    // ── RESUMEN GENERAL ───────────────────────────────────────────────────
    children.push(heading('RESUMEN GENERAL'));

    // Párrafo 1: totales y comparativa mensual
    const p1runs = [t(`En ${mesNombreLower} de ${mes.split(' ')[1]}, Peñíscola registró un total de `)];
    p1runs.push(b(fmt(kgC) + ' kg'));
    p1runs.push(t(' de residuos recogidos por el camión (sistema RFID), en '));
    p1runs.push(b(fmt(sal) + ' salidas'));
    if (compMes.kgCamion && periodoAnt) {
        const dir = diffMesKg >= 0 ? 'incremento' : 'descenso';
        p1runs.push(t(`. Esto representa un ${dir} del `));
        p1runs.push(b(Math.abs(diffMesKg).toFixed(2).replace('.', ',') + ' %'));
        p1runs.push(t(` respecto a ${periodoAnt}`));
        if (compAnio.kgCamion && periodoAnio) {
            const dirA = diffAnioKg >= 0 ? 'incremento' : 'descenso';
            p1runs.push(t(`. En comparación con `));
            p1runs.push(b(periodoAnio));
            p1runs.push(t(`, la cantidad de residuos registró un ${dirA} del `));
            p1runs.push(b(Math.abs(diffAnioKg).toFixed(2).replace('.', ',') + ' %'));
        }
        p1runs.push(t('.'));
    }
    children.push(p(p1runs));

    // Párrafo 2: hoteles y campings
    if (kgHotelesFiltrados > 0) {
        const p2runs = [t(`Los hoteles y campings generaron `)];
        p2runs.push(b(fmt(kgHotelesFiltrados) + ' kg'));
        p2runs.push(t(`, representando el `));
        p2runs.push(b(pctH.toFixed(1).replace('.', ',') + ' %'));
        p2runs.push(t(' del total recogido.'));
        if (topHotel1) {
            p2runs.push(t(` El mayor productor fue `));
            p2runs.push(b(topHotel1[0]));
            p2runs.push(t(` con ${fmt(topHotel1[1])} kg`));
            if (topHotel2) {
                p2runs.push(t(`, seguido de `));
                p2runs.push(b(topHotel2[0]));
                p2runs.push(t(` con ${fmt(topHotel2[1])} kg`));
                if (topHotel3) {
                    p2runs.push(t(` y `));
                    p2runs.push(b(topHotel3[0]));
                    p2runs.push(t(` con ${fmt(topHotel3[1])} kg`));
                }
            }
            p2runs.push(t('.'));
        }
        children.push(p(p2runs));
    }

    // Párrafo 3: tipos de residuo
    if (tipos.length) {
        const tipoTotal = tipos.reduce((s, [, k]) => s + k, 0);
        const p3runs = [t('En cuanto a la tipología de residuos, ')];
        tipos.forEach(([tipo, kg], i) => {
            const pctTipo = tipoTotal > 0 ? (kg / tipoTotal * 100).toFixed(1).replace('.', ',') : '0';
            if (i > 0) p3runs.push(t(i === tipos.length - 1 ? ' y ' : ', '));
            p3runs.push(t('la '));
            p3runs.push(b(tipo.toLowerCase()));
            p3runs.push(t(` representó el `));
            p3runs.push(b(pctTipo + ' %'));
            p3runs.push(t(` (${fmt(kg)} kg)`));
        });
        p3runs.push(t('.'));
        children.push(p(p3runs));
    }

    // ── CONCLUSIONES ─────────────────────────────────────────────────────
    children.push(spacer());
    children.push(heading('CONCLUSIONES'));

    const cRuns = [];
    if (diffMesKg != null && periodoAnt) {
        const dir  = diffMesKg >= 0 ? 'aumento' : 'reducción';
        const dirA = diffAnioKg != null && diffAnioKg >= 0 ? 'incremento' : 'descenso';
        cRuns.push(t(`En conclusión, el informe de ${mesNombreLower} de ${mes.split(' ')[1]} refleja un ${dir} del `));
        cRuns.push(b(Math.abs(diffMesKg).toFixed(2).replace('.', ',') + ' %'));
        cRuns.push(t(` en la generación de residuos en comparación con ${periodoAnt}`));
        if (diffAnioKg != null && periodoAnio) {
            cRuns.push(t(`. En perspectiva interanual, respecto a ${periodoAnio}, se registra un ${dirA} del `));
            cRuns.push(b(Math.abs(diffAnioKg).toFixed(2).replace('.', ',') + ' %'));
        }
        cRuns.push(t('.'));
    } else {
        cRuns.push(t(`En ${mesNombreLower} de ${mes.split(' ')[1]} se recogieron `));
        cRuns.push(b(fmt(kgC) + ' kg'));
        cRuns.push(t(' de residuos en '));
        cRuns.push(b(fmt(sal) + ' salidas'));
        cRuns.push(t('.'));
    }
    if (kgHotelesFiltrados > 0 && compMes.kgCamion) {
        const hotelDiff = ((kgHotelesFiltrados / kgC) * 100).toFixed(1);
        cRuns.push(t(` Los establecimientos hoteleros y campings aportaron el `));
        cRuns.push(b(pctH.toFixed(1).replace('.', ',') + ' %'));
        cRuns.push(t(' del total de residuos del camión.'));
    }
    children.push(p(cRuns));

    // Aspectos clave
    children.push(spacer(0.5));
    children.push(p([b('Aspectos Clave:')]));

    const aspectos = [];
    if (diffMesKg != null && periodoAnt) {
        aspectos.push([
            t(`${mesNombre} mostró un ${diffMesKg >= 0 ? 'aumento' : 'descenso'} del `),
            b(Math.abs(diffMesKg).toFixed(2).replace('.', ',') + ' %'),
            t(` en la generación de residuos respecto a ${periodoAnt}.`)
        ]);
    }
    if (diffAnioKg != null && periodoAnio) {
        aspectos.push([
            t('En comparación con '),
            b(periodoAnio),
            t(`, los residuos ${diffAnioKg >= 0 ? 'aumentaron' : 'disminuyeron'} un `),
            b(Math.abs(diffAnioKg).toFixed(2).replace('.', ',') + ' %'),
            t('.')
        ]);
    }
    if (kgHotelesFiltrados > 0) {
        const top2 = hoteles.slice(0, 2).map(([h, k]) => `${h} (${fmt(k)} kg)`).join(' y ');
        aspectos.push([
            t('Los hoteles y campings generaron '),
            b(fmt(kgHotelesFiltrados) + ' kg'),
            t(` (${pctH.toFixed(1).replace('.', ',')} % del total)${top2 ? `. Principales: ${top2}` : ''}.`)
        ]);
    }
    if (topCont1) {
        aspectos.push([
            t('El contenedor más utilizado fue el '),
            b(topCont1[0]),
            t(` con ${fmt(topCont1[1])} kg`)
            , ...(topCont2 ? [t(`, seguido del `), b(topCont2[0]), t(` con ${fmt(topCont2[1])} kg`)] : []),
            t('.')
        ]);
    }
    if (compMes.diffSalidas != null) {
        aspectos.push([
            t('El número de salidas del camión '),
            b(diffMesSal >= 0 ? 'aumentó' : 'disminuyó'),
            t(` un `),
            b(Math.abs(diffMesSal).toFixed(2).replace('.', ',') + ' %'),
            t(` respecto a ${periodoAnt} (${fmt(sal)} salidas).`)
        ]);
    }

    aspectos.forEach((runs) => children.push(bulletItem(runs)));

    // ── RESIDUOS POR HOTEL ────────────────────────────────────────────────
    children.push(spacer());
    children.push(heading('RESIDUOS POR HOTEL Y CAMPING'));

    const ph1runs = [
        t(`En ${mesNombreLower} de ${mes.split(' ')[1]}, Peñíscola registró un total de `),
        b(fmt(kgC) + ' kg'),
        t(' de residuos recogidos mediante el sistema RFID del camión, con '),
        b(fmt(sal) + ' salidas'),
        t(' realizadas.'),
    ];
    if (diffMesKg != null && periodoAnt) {
        ph1runs.push(t(` Este volumen supone un ${signo(diffMesKg)} del `));
        ph1runs.push(b(Math.abs(diffMesKg).toFixed(2).replace('.', ',') + ' %'));
        ph1runs.push(t(` respecto a ${periodoAnt}.`));
    }
    children.push(p(ph1runs));

    if (kgHotelesFiltrados > 0) {
        const ph2runs = [
            t('De los residuos generados, los '),
            b('hoteles y campings'),
            t(' aportaron '),
            b(fmt(kgHotelesFiltrados) + ' kg'),
            t(`, lo que representa el `),
            b(pctH.toFixed(1).replace('.', ',') + ' %'),
            t(' del total del camión. '),
        ];
        if (topHotel1) {
            ph2runs.push(t('El establecimiento que más residuos produjo fue '));
            ph2runs.push(b(topHotel1[0]));
            ph2runs.push(t(` con ${fmt(topHotel1[1])} kg`));
            if (topHotel2) {
                ph2runs.push(t(', seguido de '));
                ph2runs.push(b(topHotel2[0]));
                ph2runs.push(t(` con ${fmt(topHotel2[1])} kg`));
            }
            if (topHotel3) {
                ph2runs.push(t(' y '));
                ph2runs.push(b(topHotel3[0]));
                ph2runs.push(t(` con ${fmt(topHotel3[1])} kg`));
            }
            ph2runs.push(t('.'));
        }
        children.push(p(ph2runs));

        // Tabla pequeña de hoteles
        if (hoteles.length > 3) {
            const hotelTotal = hoteles.reduce((s, [, k]) => s + k, 0);
            children.push(spacer(0.5));
            children.push(buildSmallTable(
                ['Establecimiento', 'Kg recogidos', '% sobre hoteles'],
                hoteles.slice(0, 10).map(([h, k]) => [
                    h,
                    fmt(k) + ' kg',
                    hotelTotal > 0 ? (k / hotelTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—'
                ])
            ));
            children.push(spacer(0.5));
        }
    }

    // ── RESIDUOS POR TIPO DE CONTENEDOR ──────────────────────────────────
    children.push(spacer());
    children.push(heading('RESIDUOS POR TIPO DE CONTENEDOR'));

    if (contened.length) {
        const contTotal = contened.reduce((s, [, k]) => s + k, 0);
        const pc1runs = [
            t('En cuanto a los contenedores de residuos, el tipo que más ha acumulado es el '),
            b(topCont1[0]),
            t(` con `),
            b(fmt(topCont1[1]) + ' kg'),
        ];
        if (topCont2) {
            pc1runs.push(t('. A continuación, el '));
            pc1runs.push(b(topCont2[0]));
            pc1runs.push(t(` con `));
            pc1runs.push(b(fmt(topCont2[1]) + ' kg'));
        }
        if (contHotel) {
            pc1runs.push(t('. Los contenedores de hoteles ('));
            pc1runs.push(b(contHotel[0]));
            pc1runs.push(t(`) acumularon `));
            pc1runs.push(b(fmt(contHotel[1]) + ' kg'));
        }
        pc1runs.push(t('.'));
        children.push(p(pc1runs));

        // Tabla contenedores
        children.push(spacer(0.5));
        children.push(buildSmallTable(
            ['Tipo de contenedor', 'Kg recogidos', '% del total'],
            contened.map(([c, k]) => [
                c,
                fmt(k) + ' kg',
                contTotal > 0 ? (k / contTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—'
            ])
        ));

        // Párrafo zona
        if (zonas.length) {
            children.push(spacer(0.5));
            const topZona = zonas[0];
            const pzruns = [
                t('Por zonas, la más activa fue '),
                b(topZona[0]),
                t(` con `),
                b(fmt(topZona[1]) + ' kg'),
                t(' recogidos'),
            ];
            if (zonas[1]) {
                pzruns.push(t(', seguida de '));
                pzruns.push(b(zonas[1][0]));
                pzruns.push(t(` con ${fmt(zonas[1][1])} kg`));
            }
            pzruns.push(t('.'));
            children.push(p(pzruns));
        }
    }

    return children;
}

// ── Mini-tabla de datos ───────────────────────────────────────────────────
function buildSmallTable(headers, rows) {
    const W_TOTAL = 9026; // A4 content width (DXA)
    const colCount = headers.length;
    // Primera columna más ancha
    const w0 = Math.round(W_TOTAL * 0.55);
    const wRest = Math.round((W_TOTAL - w0) / (colCount - 1));
    const colWidths = [w0, ...Array(colCount - 1).fill(wRest)];

    const borderDef = { style: BorderStyle.SINGLE, size: 4, color: 'D0D7E2' };
    const borders = { top: borderDef, bottom: borderDef, left: borderDef, right: borderDef, insideH: borderDef, insideV: borderDef };

    const mkCell = (text, isHeader, width, align = AlignmentType.LEFT) =>
        new TableCell({
            width: { size: width, type: WidthType.DXA },
            shading: isHeader ? { fill: COLOR_AZUL, type: ShadingType.CLEAR } : undefined,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
                alignment: align,
                children: [new TextRun({
                    text: String(text ?? ''),
                    bold: isHeader,
                    size: 18,
                    color: isHeader ? 'FFFFFF' : '1A2332',
                })],
            })],
        });

    const headerRow = new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => mkCell(h, true, colWidths[i], i > 0 ? AlignmentType.RIGHT : AlignmentType.LEFT)),
    });
    const dataRows = rows.map((cells, ri) =>
        new TableRow({
            children: cells.map((cell, ci) =>
                new TableCell({
                    width: { size: colWidths[ci], type: WidthType.DXA },
                    shading: ri % 2 !== 0 ? { fill: 'F2F4F7', type: ShadingType.CLEAR } : undefined,
                    verticalAlign: VerticalAlign.CENTER,
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    children: [new Paragraph({
                        alignment: ci > 0 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                        children: [new TextRun({ text: String(cell ?? '—'), size: 18, color: '1A2332' })],
                    })],
                })
            ),
        })
    );

    return new Table({
        width: { size: W_TOTAL, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...dataRows],
    });
}

// ── Construcción del documento Word ──────────────────────────────────────
async function generarDocxCompleto(data) {
    const periodoLabel = (data.periodoLabel || '').toUpperCase();
    const anio = (data.periodo || '').split('-')[0] || '';

    const docChildren = [];

    // ── PORTADA ────────────────────────────────────────────────────────────
    if (PORTADA_PATH) {
        const ext = path.extname(PORTADA_PATH).toLowerCase();
        const imgBuf = fs.readFileSync(PORTADA_PATH);
        docChildren.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new ImageRun({
                    type: (ext === '.jpg' || ext === '.jpeg') ? 'jpg' : 'png',
                    data: imgBuf,
                    transformation: { width: 600, height: 360 },
                    altText: { title: 'Portada', description: 'Imagen portada', name: 'portada' },
                })],
            })
        );
    }

    // Bloque título portada
    const shadAzul = { fill: COLOR_AZUL, type: ShadingType.CLEAR };
    docChildren.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: PORTADA_PATH ? 80 : 400, after: 0 },
            shading: shadAzul,
            children: [new TextRun({ text: 'INFORME', size: 56, bold: true, color: 'FFFFFF' })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            shading: shadAzul,
            children: [new TextRun({ text: 'RESIDUOS', size: 56, bold: true, color: 'FFFFFF' })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            shading: shadAzul,
            children: [new TextRun({ text: periodoLabel, size: 32, bold: true, color: 'A8C8FF' })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: PORTADA_PATH ? 0 : 100 },
            shading: shadAzul,
            children: [new TextRun({ text: 'Ajuntament de Peñíscola', size: 22, color: 'C8D8F0', italics: true })],
        })
    );

    // Salto de página al contenido
    docChildren.push(new Paragraph({ children: [new PageBreak()] }));

    // ── Contenido narrativo ────────────────────────────────────────────────
    const contenido = generarContenido(data);
    docChildren.push(...contenido);

    // ── Documento final ────────────────────────────────────────────────────
    const doc = new Document({
        creator: 'Ajuntament de Peñíscola',
        title: `Informe Residuos ${data.periodoLabel}`,
        subject: 'Residuos Sólidos Urbanos',
        styles: {
            default: {
                document: { run: { font: 'Calibri', size: 22, color: '1A2332' } },
            },
        },
        sections: [{
            properties: {
                page: {
                    size: { width: 11906, height: 16838 }, // A4
                    margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }, // ~2cm
                },
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                            new TextRun({ text: `Informe Residuos ${data.periodoLabel}  ·  Pág. `, size: 16, color: '888888' }),
                            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
                        ],
                    })],
                }),
            },
            children: docChildren,
        }],
    });

    return await Packer.toBuffer(doc);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
    // Cargamos los datos del camión directamente desde el JSON local
    const camionPath = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'todos.json');
    if (!fs.existsSync(camionPath)) {
        console.error('❌ No se encuentra data/RESIDUOS/camion/todos.json');
        process.exit(1);
    }

    console.log('⏳ Cargando todos.json (puede tardar unos segundos)…');
    const camion = JSON.parse(fs.readFileSync(camionPath, 'utf8'));
    console.log(`✅ ${camion.length.toLocaleString('es-ES')} registros cargados.`);

    // Pesajes desde resumen.json
    let pesajesData = [];
    try {
        const rp = path.join(__dirname, 'data', 'RESIDUOS', 'resumen.json');
        if (fs.existsSync(rp)) pesajesData = JSON.parse(fs.readFileSync(rp, 'utf8')).pesajes || [];
    } catch (_) {}

    const mesesArg = process.argv.slice(2);
    const meses = mesesArg.length > 0 ? mesesArg : ['2025-08', '2025-09', '2025-10'];

    for (const mes of meses) {
        if (!/^\d{4}-\d{2}$/.test(mes)) { console.warn(`⚠️  Formato inválido: ${mes} (usa YYYY-MM)`); continue; }

        const [anio, mesNum] = mes.split('-').map(Number);
        const mesPrev         = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, '0')}`;
        const mesAnioAnterior = `${anio - 1}-${String(mesNum).padStart(2, '0')}`;

        const rowsMes     = camion.filter((r) => r.fecha === mes);
        const rowsPrev    = camion.filter((r) => r.fecha === mesPrev);
        const rowsAnioAnt = camion.filter((r) => r.fecha === mesAnioAnterior);

        const kgCamion    = rowsMes.reduce((s, r) => s + (r.kg || 0), 0);
        const salidasMes  = rowsMes.length;
        const kgPrev      = rowsPrev.reduce((s, r) => s + (r.kg || 0), 0);
        const salPrev     = rowsPrev.length;
        const kgAnioAnt   = rowsAnioAnt.reduce((s, r) => s + (r.kg || 0), 0);
        const salAnioAnt  = rowsAnioAnt.length;
        const kgExcel     = pesajesData.filter((r) => r.fecha === mes).reduce((s, r) => s + (r.kg || 0), 0);

        const agrupar = (key, valKey) => {
            const m = {};
            rowsMes.forEach((r) => { const k = r[key] || '—'; m[k] = (m[k] || 0) + (r[valKey] || 0); });
            return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };

        const hoteles     = agrupar('establecimiento', 'kg');
        const zonas       = agrupar('zona', 'kg');
        const tipos       = agrupar('tipo', 'kg');
        const contenedores = agrupar('containerType', 'kg');

        const kgHoteles = hoteles.filter(([h]) => h && h !== '—' && h !== 'Peñiscola RSU').reduce((s, [, k]) => s + k, 0);
        const pctH = kgCamion > 0 ? (kgHoteles / kgCamion * 100).toFixed(1) : '0';
        const pct = (a, bb) => bb > 0 ? parseFloat(((a - bb) / bb * 100).toFixed(2)) : null;

        const data = {
            periodo: mes,
            periodoLabel: labelMes(mes),
            kgCamion, kgExcel, salidas: salidasMes,
            hoteles: hoteles.slice(0, 15),
            zonas: zonas.slice(0, 12),
            tipos: tipos.slice(0, 8),
            contenedores: contenedores.slice(0, 12),
            pctResiduosHoteles: pctH,
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

        console.log(`\n📄 Generando informe de ${data.periodoLabel}…`);
        const buf  = await generarDocxCompleto(data);
        const nombre = `${mes.replace('-', '_')}_Informe_Residuos_${data.periodoLabel.replace(/\s+/g, '_')}.docx`;
        const outPath = path.join(OUT_DIR, nombre);
        fs.writeFileSync(outPath, buf);
        console.log(`   ✅ Guardado: ${outPath}`);
        console.log(`      → ${fmt(kgCamion)} kg camión · ${fmt(salidasMes)} salidas · ${pctH} % hoteles`);
    }

    console.log(`\n🎉 Informes guardados en: ${OUT_DIR}`);
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exit(1); });
