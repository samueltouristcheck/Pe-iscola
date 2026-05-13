/**
 * Genera informe Word (.docx) profesional de residuos para el Ayuntamiento de Peñíscola.
 * Portada: imagen cover + título sobre fondo azul institucional.
 * Contenido: resumen ejecutivo, tablas de datos, comparación anual, conclusiones.
 */
const fs   = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, ImageRun,
    AlignmentType, PageBreak, HeadingLevel, ShadingType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    VerticalAlign, convertInchesToTwip
} = require('docx');

const EJEMPLOS_DIR = path.join(__dirname, 'informes_ejemplo');

const COLOR_AZUL   = '1B3A6B';   // azul institucional Peñíscola
const COLOR_VERDE  = '2E7D32';   // verde (residuos/medio ambiente)
const COLOR_BLANCO = 'FFFFFF';
const COLOR_GRIS_C = 'F2F4F7';   // gris claro para filas alternas
const COLOR_GRIS_B = 'E8ECF0';   // gris cabecera tabla

function getRutaPortada() {
    const candidatos = [
        path.join(EJEMPLOS_DIR, 'Imagen_portada.png'),
        path.join(EJEMPLOS_DIR, 'imagen_portada.png'),
        path.join(EJEMPLOS_DIR, 'portada.png'),
        path.join(EJEMPLOS_DIR, 'portada.jpg'),
    ];
    for (const p of candidatos) { if (fs.existsSync(p)) return p; }
    return null;
}

const fmt     = (n) => (n ?? 0).toLocaleString('es-ES');
const fmtPct  = (n) => n != null ? (n > 0 ? '+' : '') + n.toFixed(2).replace('.', ',') + ' %' : '—';
const MESES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Helpers para construir elementos docx ─────────────────────────────────
function txt(text, opts = {}) {
    return new TextRun({ text: String(text ?? ''), ...opts });
}

function heading(text, level = HeadingLevel.HEADING_2, color = COLOR_AZUL) {
    return new Paragraph({
        heading: level,
        spacing: { before: 280, after: 120 },
        children: [txt(text, { bold: true, size: level === HeadingLevel.HEADING_1 ? 32 : 26, color })],
    });
}

function para(text, opts = {}) {
    return new Paragraph({
        spacing: { after: 140 },
        children: [txt(text, { size: 22, ...opts })],
    });
}

function separator() {
    return new Paragraph({
        spacing: { before: 80, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7E2' } },
        children: [],
    });
}

/** Crea una tabla con cabecera azul y filas alternas. */
function dataTable(headers, rows) {
    const CELL_PADDING = { top: 80, bottom: 80, left: 120, right: 120 };

    function mkCell(text, opts = {}) {
        const { header = false, align = AlignmentType.LEFT, bg = null, bold = false } = opts;
        return new TableCell({
            shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_PADDING,
            children: [
                new Paragraph({
                    alignment: align,
                    children: [txt(text, {
                        bold:  bold || header,
                        size:  header ? 20 : 20,
                        color: header ? COLOR_BLANCO : '1A2332',
                    })],
                }),
            ],
        });
    }

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'D0D7E2' };

    // Cabecera
    const headerRow = new TableRow({
        tableHeader: true,
        children: headers.map((h) =>
            new TableCell({
                shading: { fill: COLOR_AZUL, type: ShadingType.CLEAR },
                verticalAlign: VerticalAlign.CENTER,
                margins: CELL_PADDING,
                children: [new Paragraph({
                    alignment: typeof h === 'object' && h.align ? h.align : AlignmentType.LEFT,
                    children: [txt(
                        typeof h === 'object' ? h.label : h,
                        { bold: true, size: 20, color: COLOR_BLANCO }
                    )],
                })],
            })
        ),
    });

    // Filas de datos
    const dataRows = rows.map((cells, ri) => {
        const bg = ri % 2 === 0 ? null : COLOR_GRIS_C;
        return new TableRow({
            children: cells.map((cell, ci) => {
                const hdr = headers[ci];
                const align = typeof hdr === 'object' && hdr.align ? hdr.align : AlignmentType.LEFT;
                const isNum = typeof hdr === 'object' && hdr.num;
                return mkCell(String(cell ?? '—'), { bg, align: isNum ? AlignmentType.RIGHT : align });
            }),
        });
    });

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...dataRows],
    });
}

/** Tabla de KPIs de comparación entre periodos. */
function comparacionTable(data) {
    const compMes  = data.comparacionMesAnterior  || {};
    const compAnio = data.comparacionAnioAnterior  || {};

    const headers = [
        { label: 'Periodo' },
        { label: 'Kg recogidos',  num: true, align: AlignmentType.RIGHT },
        { label: 'Salidas',       num: true, align: AlignmentType.RIGHT },
        { label: 'Var. kg',       num: true, align: AlignmentType.RIGHT },
        { label: 'Var. salidas',  num: true, align: AlignmentType.RIGHT },
    ];

    const rows = [
        [
            data.periodoLabel || '',
            fmt(data.kgCamion),
            fmt(data.salidas),
            '—',
            '—',
        ],
    ];

    if (compMes.periodo) {
        rows.push([
            compMes.periodo + ' (mes anterior)',
            fmt(compMes.kgCamion),
            fmt(compMes.salidas),
            fmtPct(compMes.diffCamion),
            fmtPct(compMes.diffSalidas),
        ]);
    }
    if (compAnio.periodo) {
        rows.push([
            compAnio.periodo + ' (año anterior)',
            fmt(compAnio.kgCamion),
            fmt(compAnio.salidas),
            fmtPct(compAnio.diffCamion),
            fmtPct(compAnio.diffSalidas),
        ]);
    }

    return dataTable(headers, rows);
}

// ── Función principal ─────────────────────────────────────────────────────
async function generarDocx(data) {
    const periodoLabel  = (data.periodoLabel || '').toUpperCase();
    const periodoLower  = data.periodoLabel  || '';
    const rutaPortada   = getRutaPortada();

    const compMes  = data.comparacionMesAnterior  || {};
    const compAnio = data.comparacionAnioAnterior  || {};

    const zonas      = (data.zonas        || []).slice(0, 15);
    const tipos      = (data.tipos        || []).slice(0, 12);
    const hoteles    = (data.hoteles      || []).slice(0, 15);
    const contened   = (data.contenedores || []).slice(0, 12);

    const kgTotal    = (data.kgCamion || 0) + (data.kgExcel || 0);
    const pctHoteles = data.pctResiduosHoteles != null ? parseFloat(data.pctResiduosHoteles).toFixed(1).replace('.', ',') + ' %' : '—';

    // Texto resumen ejecutivo
    const difMesKg  = compMes.diffCamion  != null ? ` (${fmtPct(compMes.diffCamion)} respecto a ${compMes.periodo})` : '';
    const difAnioKg = compAnio.diffCamion != null ? ` y ${fmtPct(compAnio.diffCamion)} respecto a ${compAnio.periodo}` : '';

    const resumenTexto =
        `Durante el mes de ${periodoLower} se recogieron un total de ${fmt(data.kgCamion)} kg de residuos ` +
        `registrados mediante el sistema RFID del camión, en ${fmt(data.salidas)} salidas${difMesKg}${difAnioKg}. ` +
        (data.kgExcel > 0 ? `Adicionalmente, la báscula registró ${fmt(data.kgExcel)} kg adicionales. ` : '') +
        `Los residuos procedentes de establecimientos hoteleros y campings representaron el ${pctHoteles} del total recogido.`;

    const topZona   = zonas[0]   ? `${zonas[0][0]} (${fmt(zonas[0][1])} kg)` : '—';
    const topTipo   = tipos[0]   ? `${tipos[0][0]} (${fmt(tipos[0][1])} kg)` : '—';
    const topHotel  = hoteles[0] ? `${hoteles[0][0]} (${fmt(hoteles[0][1])} kg)` : '—';
    const topCont   = contened[0] ? `${contened[0][0]} (${fmt(contened[0][1])} kg)` : '—';

    const conclusionTexto =
        `La zona con mayor volumen de residuos fue ${topZona}. El tipo de residuo predominante fue ${topTipo}. ` +
        `El contenedor más utilizado fue ${topCont}. ` +
        (hoteles.length ? `El principal establecimiento generador fue ${topHotel}. ` : '') +
        (compAnio.diffCamion != null
            ? `En comparación interanual, la recogida ${compAnio.diffCamion >= 0 ? 'aumentó' : 'disminuyó'} un ${Math.abs(compAnio.diffCamion).toFixed(1).replace('.', ',')} % respecto a ${compAnio.periodo}.`
            : '');

    // ── Construcción del documento ────────────────────────────────────────
    const children = [];

    // ── PORTADA ───────────────────────────────────────────────────────────
    if (rutaPortada) {
        const ext       = path.extname(rutaPortada).toLowerCase();
        const tipo      = (ext === '.jpg' || ext === '.jpeg') ? 'jpg' : 'png';
        const imgBuffer = fs.readFileSync(rutaPortada);
        children.push(
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [
                    new ImageRun({ type: tipo, data: imgBuffer, transformation: { width: 600, height: 370 } }),
                ],
            })
        );
    }

    // Bloque de título (fondo azul institucional)
    const shadAzul = { fill: COLOR_AZUL, type: ShadingType.CLEAR };
    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: rutaPortada ? 60 : 200, after: 0 },
            shading: shadAzul,
            children: [txt('INFORME', { size: 52, bold: true, color: COLOR_BLANCO })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            shading: shadAzul,
            children: [txt('RESIDUOS SÓLIDOS URBANOS', { size: 30, bold: true, color: COLOR_BLANCO })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            shading: shadAzul,
            children: [txt(periodoLabel, { size: 28, bold: true, color: 'A8C8FF' })],
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: rutaPortada ? 0 : 80 },
            shading: shadAzul,
            children: [txt('Ajuntament de Peñíscola', { size: 22, color: 'C8D8F0', italics: true })],
        })
    );

    // Salto de página → contenido
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── RESUMEN EJECUTIVO ────────────────────────────────────────────────
    children.push(
        heading('RESUMEN EJECUTIVO', HeadingLevel.HEADING_1),
        separator(),
        para(resumenTexto, { size: 22 })
    );

    // KPIs en una mini-tabla de 3 columnas
    const kpiHeaders = [
        { label: 'Indicador' },
        { label: 'Valor', num: true, align: AlignmentType.RIGHT },
    ];
    const kpiRows = [
        ['Total kg recogidos (camión RFID)', fmt(data.kgCamion) + ' kg'],
        ...(data.kgExcel > 0 ? [['Total kg báscula', fmt(data.kgExcel) + ' kg']] : []),
        ['Salidas del camión', fmt(data.salidas)],
        ['% Residuos hoteleros', pctHoteles],
        ...(data.matriculas && data.matriculas.length ? [['Vehículos distintos', String(data.matriculas.length)]] : []),
    ];
    children.push(
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),
        dataTable(kpiHeaders, kpiRows)
    );

    // ── COMPARACIÓN ENTRE PERIODOS ────────────────────────────────────────
    children.push(
        new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
        heading('COMPARACIÓN CON PERIODOS ANTERIORES'),
        separator(),
        comparacionTable(data)
    );

    // ── RESIDUOS POR ZONA ─────────────────────────────────────────────────
    if (zonas.length) {
        const zonaTotal = zonas.reduce((s, [, k]) => s + k, 0);
        children.push(
            new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
            heading('RESIDUOS POR ZONA'),
            separator(),
            dataTable(
                [{ label: 'Zona' }, { label: 'Kg', num: true, align: AlignmentType.RIGHT }, { label: '% del total', num: true, align: AlignmentType.RIGHT }],
                zonas.map(([z, k]) => [z, fmt(k) + ' kg', zonaTotal > 0 ? (k / zonaTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—'])
            )
        );
    }

    // ── TIPOS DE RESIDUO ──────────────────────────────────────────────────
    if (tipos.length) {
        const tipoTotal = tipos.reduce((s, [, k]) => s + k, 0);
        children.push(
            new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
            heading('TIPOS DE RESIDUO'),
            separator(),
            dataTable(
                [{ label: 'Tipo de residuo' }, { label: 'Kg', num: true, align: AlignmentType.RIGHT }, { label: '% del total', num: true, align: AlignmentType.RIGHT }],
                tipos.map(([t, k]) => [t, fmt(k) + ' kg', tipoTotal > 0 ? (k / tipoTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—'])
            )
        );
    }

    // ── TIPOS DE CONTENEDOR ───────────────────────────────────────────────
    if (contened.length) {
        const contTotal = contened.reduce((s, [, k]) => s + k, 0);
        children.push(
            new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
            heading('RESIDUOS POR TIPO DE CONTENEDOR'),
            separator(),
            dataTable(
                [{ label: 'Tipo de contenedor' }, { label: 'Kg', num: true, align: AlignmentType.RIGHT }, { label: '% del total', num: true, align: AlignmentType.RIGHT }],
                contened.map(([c, k]) => [c, fmt(k) + ' kg', contTotal > 0 ? (k / contTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—'])
            )
        );
    }

    // ── ESTABLECIMIENTOS (HOTELES / CAMPINGS) ─────────────────────────────
    if (hoteles.length) {
        const hotelTotal = hoteles.reduce((s, [, k]) => s + k, 0);
        children.push(
            new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
            heading('ESTABLECIMIENTOS HOTELEROS Y CAMPINGS'),
            separator(),
            para(`Los establecimientos hoteleros y campings generaron un total de ${fmt(hotelTotal)} kg, representando el ${pctHoteles} del total recogido en el periodo.`, { size: 20 }),
            dataTable(
                [
                    { label: 'Establecimiento' },
                    { label: 'Kg', num: true, align: AlignmentType.RIGHT },
                    { label: '% sobre hoteles', num: true, align: AlignmentType.RIGHT },
                ],
                hoteles.map(([h, k]) => [
                    h === '—' ? 'Sin identificar' : h,
                    fmt(k) + ' kg',
                    hotelTotal > 0 ? (k / hotelTotal * 100).toFixed(1).replace('.', ',') + ' %' : '—',
                ])
            )
        );
    }

    // ── CONCLUSIONES ──────────────────────────────────────────────────────
    children.push(
        new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
        heading('CONCLUSIONES'),
        separator(),
        para(conclusionTexto, { size: 22 }),
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }),
        new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [txt('Peñíscola, ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }), { size: 20, italics: true, color: '666666' })],
        })
    );

    // ── Documento final ───────────────────────────────────────────────────
    const doc = new Document({
        creator: 'Ajuntament de Peñíscola',
        title:   'Informe Residuos ' + periodoLabel,
        subject: 'Residuos Sólidos Urbanos',
        styles: {
            default: {
                document: {
                    run: { font: 'Calibri', size: 22 },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    margin: {
                        top:    convertInchesToTwip(1),
                        bottom: convertInchesToTwip(1),
                        left:   convertInchesToTwip(1.1),
                        right:  convertInchesToTwip(1.1),
                    },
                },
            },
            children,
        }],
    });

    return await Packer.toBuffer(doc);
}

module.exports = { generarDocx, getRutaPortada };
