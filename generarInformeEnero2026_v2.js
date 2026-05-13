'use strict';
/**
 * Informe Enero 2026 — v2
 * Portada: foto aérea Peñíscola a página completa + título superpuesto
 * Cuerpo:  texto narrativo + gráficos embebidos
 * Anexo:   tablas detalladas con datos completos
 */
const fs   = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, ImageRun,
    AlignmentType, PageBreak, ShadingType,
    Header, Footer, PageNumber, BorderStyle, WidthType,
    Table, TableRow, TableCell, VerticalAlign, convertInchesToTwip
} = require('docx');

const OUT_DIR    = path.join(__dirname, 'informes_generados');
const GRAFICOS   = path.join(OUT_DIR, 'graficos');
const FOTO_COVER = path.join(__dirname, 'informes_ejemplo', 'portada_foto_3.jpg');
const LOGO_PATH  = path.join(__dirname, 'informes_ejemplo', 'portada_foto_0.png'); // logo pequeño

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Constantes de estilo ─────────────────────────────────────────────────
const C_AZUL   = '1B3A6B';
const C_AZUL2  = '2E5FA3';
const C_VERDE  = '2D6A4F';
const C_BLANCO = 'FFFFFF';
const C_GRIS   = '64748B';
const C_TEXTO  = '1E293B';
const C_FONDO  = 'EFF6FF';   // fondo azul muy claro para celdas par
const C_CABEZA = '1B3A6B';   // cabecera tabla

const fmt = (n) => Math.round(n || 0).toLocaleString('es-ES');

// ── Helpers tipográficos ─────────────────────────────────────────────────
const rn = (t, o={}) => new TextRun({ text: String(t), size: 22, font: 'Calibri', color: C_TEXTO, ...o });
const rb = (t, o={}) => new TextRun({ text: String(t), size: 22, font: 'Calibri', bold: true, color: C_TEXTO, ...o });
const rh = (t, o={}) => new TextRun({ text: String(t), size: 20, font: 'Calibri', bold: true, color: C_BLANCO, ...o });

function para(runs, antes=0, despues=180) {
    return new Paragraph({
        spacing: { before: antes, after: despues, line: 288 },
        children: Array.isArray(runs) ? runs : [rn(runs)],
    });
}

function seccion(texto) {
    return new Paragraph({
        spacing: { before: 360, after: 140 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: C_AZUL, space: 6 } },
        children: [new TextRun({ text: texto, size: 30, bold: true, color: C_AZUL, font: 'Calibri' })],
    });
}

function subseccion(texto) {
    return new Paragraph({
        spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: texto, size: 24, bold: true, color: C_AZUL2, font: 'Calibri' })],
    });
}

function check(runs) {
    return new Paragraph({
        spacing: { before: 100, after: 100 },
        indent: { left: 160 },
        children: [
            new TextRun({ text: '✓  ', size: 22, bold: true, color: C_AZUL, font: 'Calibri' }),
            ...(Array.isArray(runs) ? runs : [rn(runs)]),
        ],
    });
}

function esp(n=1) { return new Paragraph({ spacing: { after: n*100 }, children: [] }); }

// Imagen embebida centrada
function imgCentrada(rutaImg, anchoMM, altoMM, titulo='') {
    if (!fs.existsSync(rutaImg)) return esp();
    const ext = path.extname(rutaImg).toLowerCase();
    const tipo = (ext === '.jpg' || ext === '.jpeg') ? 'jpg' : 'png';
    const buf = fs.readFileSync(rutaImg);
    const w = Math.round(anchoMM * 3.78); // mm → px aprox para docx (EMU via docx)
    const h = Math.round(altoMM  * 3.78);
    const elems = [];
    if (titulo) {
        elems.push(new Paragraph({
            spacing: { before: 200, after: 60 },
            children: [new TextRun({ text: titulo, size: 19, italics: true, color: C_GRIS, font: 'Calibri' })],
        }));
    }
    elems.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: titulo ? 0 : 200, after: 140 },
        children: [new ImageRun({
            type: tipo, data: buf,
            transformation: { width: w, height: h },
            altText: { title: titulo || 'gráfico', description: titulo || '', name: titulo || 'img' },
        })],
    }));
    return elems;
}

// ── Tabla de datos bonita ─────────────────────────────────────────────────
function tablaData(headers, rows, colWidths) {
    // colWidths en DXA; headers = [{label, align}] o string
    const TOTAL = colWidths.reduce((a, b) => a + b, 0);
    const brd = { style: BorderStyle.SINGLE, size: 4, color: 'D0D9E8' };
    const borders = { top: brd, bottom: brd, left: brd, right: brd };

    const mkCell = (txt, w, bg, bold, align=AlignmentType.LEFT, colorTxt=C_TEXTO) =>
        new TableCell({
            width: { size: w, type: WidthType.DXA },
            shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 70, bottom: 70, left: 120, right: 120 },
            children: [new Paragraph({
                alignment: align,
                children: [new TextRun({ text: String(txt ?? '—'), size: 19, bold, font: 'Calibri', color: colorTxt })],
            })],
        });

    const headerRow = new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => {
            const lbl   = typeof h === 'object' ? h.label : h;
            const align = typeof h === 'object' && h.right ? AlignmentType.RIGHT : AlignmentType.LEFT;
            return mkCell(lbl, colWidths[i], C_CABEZA, true, align, C_BLANCO);
        }),
    });

    const dataRows = rows.map((cells, ri) => {
        const bg = ri % 2 === 0 ? null : C_FONDO;
        return new TableRow({
            children: cells.map((cell, ci) => {
                const h = headers[ci];
                const align = typeof h === 'object' && h.right ? AlignmentType.RIGHT : AlignmentType.LEFT;
                const bold  = ci === 0;
                return mkCell(cell, colWidths[ci], bg, bold, align);
            }),
        });
    });

    return new Table({
        width: { size: TOTAL, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...dataRows],
    });
}

// ── Datos Enero 2026 ─────────────────────────────────────────────────────
const D = {
    kgExcel: 468740, kgCamion: 88187, salidas: 1883,
    dic_kgExcel: 536480, dic_kgCamion: 244749, dic_salidas: 3430,
    ene25_kgExcel: 471240,
    varExcelDic: -12.6, varExcelEne25: -0.5, varCamionDic: -64.0,
    pctHoteles: 66.8,
    hoteles: [
        ['ATALAYAS','Urbanización',9790],['Camping Edén','Camping',5610],
        ['SUBURBANO','Urbanización',5270],['URMI','Urbanización',4035],
        ['Hotel Peñíscola Suites','Hotel',3860],['Camping Vizmar','Camping',3190],
        ['Camping La Volta','Camping',2885],['CAMPING EL CID','Camping',1910],
        ['porto cristo','Otros',1761],['CERRO-MAR','Urbanización',3505],
    ],
    contenedores: [
        ['CONTENEDOR RSU 1.100 TRASERA',39372],['CONTENEDOR RSU 800 TRASERA HOTELES',15085],
        ['CONTENEDOR ORGÁNICA 800l. HOTELES',11781],['CONTENEDOR ORGÁNICA 1.100 TRASERA',5394],
        ['CONTENEDOR ENVASES 800l. HOTELES',2015],['CONTENEDOR RSU 3.200 LATERAL',1360],
        ['CONTENEDOR PAPEL/CARTÓN 800l. HOTELES',1170],['CONTENEDOR ENVASES 3.200 LATERAL',340],
        ['CONTENEDOR RSU 240 LITROS',302],['CONTENEDOR RSU 140 LITROS',10],
    ],
    zonas: [
        ['Llandells - Estación',19994],['Urbanizaciones',18165],['Centro Suburbano',12992],
        ['Carretera Estación',11594],['Zona Norte 1',11520],['Zona Norte Interior',8247],
        ['Casco Antiguo',904],
    ],
    tipos: [
        ['Mezcla de residuos municipales (RSU)',61196,69.4],
        ['Orgánica',22236,25.2],
        ['Envases mezclados',3585,4.1],
        ['Papel y cartón',1170,1.3],
    ],
    matriculas: [
        ['6998MYN',50005],['7542KBV',36170],['7809JZX',2012],
    ],
};

// ── Construcción del documento ────────────────────────────────────────────
async function generarInforme() {
    const children = [];

    // ══════════════════════════════════════════════════════════════════════
    // PORTADA — foto de Peñíscola a página completa + bloque título oscuro
    // ══════════════════════════════════════════════════════════════════════
    if (fs.existsSync(FOTO_COVER)) {
        const buf = fs.readFileSync(FOTO_COVER);
        // Foto que ocupe todo el ancho (170mm × 130mm)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new ImageRun({
                type: 'jpg', data: buf,
                transformation: { width: 643, height: 430 },
                altText: { title: 'Peñíscola', description: 'Vista aérea de Peñíscola', name: 'portada' },
            })],
        }));
    }

    // Bloque negro semitransparente simulado con fondo oscuro
    const shadOscuro = { fill: '0A1628', type: ShadingType.CLEAR };
    children.push(
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: 'AJUNTAMENT DE PEÑÍSCOLA', size: 18, color: '7BA4D4', font: 'Calibri', allCaps: true, characterSpacing: 60 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: 'INFORME', size: 64, bold: true, color: C_BLANCO, font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: 'RESIDUOS  SÓLIDOS  URBANOS', size: 28, bold: true, color: '90B8E0', font: 'Calibri', characterSpacing: 40 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 20, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: 'ENERO   2026', size: 36, bold: true, color: 'FFD700', font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 20, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: '─────────────────────────────────', size: 14, color: '3B5998', font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 10, after: 0 }, shading: shadOscuro,
            children: [new TextRun({ text: 'Servei de Neteja i Residus Municipals', size: 20, italics: true, color: 'A0BDD8', font: 'Calibri' })] }),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 2 — RESUMEN GENERAL
    // ══════════════════════════════════════════════════════════════════════
    children.push(
        para([rn('Enero de 2026 se confirma como un mes de '), rb('temporada baja profunda'),
            rn(' en Peñíscola, con una reducción sustancial en los volúmenes de residuos respecto a diciembre y un comportamiento prácticamente idéntico al del mismo mes del año anterior. En total, el sistema de báscula registró '), rb(fmt(D.kgExcel) + ' kg'),
            rn(', un '), rb(Math.abs(D.varExcelDic).toFixed(1).replace('.', ',') + ' % menos'),
            rn(' que en diciembre de 2025 (' + fmt(D.dic_kgExcel) + ' kg), y solo un '),
            rb(Math.abs(D.varExcelEne25).toFixed(1).replace('.', ',') + ' % menos'),
            rn(' que en enero de 2025 (' + fmt(D.ene25_kgExcel) + ' kg), lo que confirma la '),
            rb('estabilidad estructural del servicio'), rn(' durante el periodo invernal.')]),

        para([rn('El sistema RFID del camión contabilizó '), rb(fmt(D.kgCamion) + ' kg'),
            rn(' en '), rb(fmt(D.salidas) + ' salidas'),
            rn(', una reducción del '), rb(Math.abs(D.varCamionDic).toFixed(1).replace('.', ',') + ' %'),
            rn(' respecto a diciembre, coherente con el ajuste de frecuencias y rutas propio de la temporada baja. El perfil de los establecimientos activos cambia radicalmente respecto al verano: los '),
            rb('campings'), rn(' (Edén, Vizmar, La Volta, El Cid) y el '),
            rb('Hotel Peñíscola Suites'), rn(' concentran la mayor parte de la generación registrada por RFID.')]),

        para([rn('El '), rb('CONTENEDOR RSU 1.100 TRASERA'), rn(' encabezó la infraestructura con '),
            rb(fmt(39372) + ' kg'), rn(', sustituyendo a los grandes laterales de 2.200 y 3.200 litros propios del verano. La '),
            rb('fracción orgánica'), rn(' representó el '), rb('25,2 %'),
            rn(' del total RFID, un porcentaje destacado para enero que puede indicar mejoras en la separación en origen en los establecimientos activos.')]),
    );

    children.push(seccion('RESUMEN GENERAL'));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 3 — CONCLUSIONES + ASPECTOS CLAVE
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Conclusiones:'));

    children.push(
        para([rn('En enero de 2026, Peñíscola confirmó el comportamiento esperado de la '),
            rb('temporada baja profunda'), rn('. Los '), rb(fmt(D.kgExcel) + ' kg'),
            rn(' recogidos en báscula representan un descenso del '),
            rb(Math.abs(D.varExcelDic).toFixed(1).replace('.', ',') + ' %'),
            rn(' respecto a diciembre, pero una variación casi nula frente a enero de 2025 ('),
            rb(D.varExcelEne25.toFixed(1).replace('.', ',') + ' %'),
            rn('), evidenciando la madurez y regularidad del sistema de gestión municipal. La '),
            rb('estabilidad interanual'), rn(' es la nota dominante del mes.')]),

        para([rn('El ajuste de '), rb('–' + Math.abs(D.varCamionDic).toFixed(0) + ' %'),
            rn(' en el sistema camión respecto a diciembre refleja la reducción de frecuencias y la optimización de rutas en la transición a la temporada baja, pasando de '),
            rb(fmt(D.dic_salidas) + ' a ' + fmt(D.salidas) + ' salidas'),
            rn('. El elevado porcentaje de orgánica recogida (' + '25,2 %'),
            rn(') apunta a avances reales en la '), rb('separación en origen'),
            rn(' en los establecimientos que mantienen actividad durante el invierno.')]),
    );

    children.push(esp(0.5));
    children.push(para([rb('Aspectos Clave:')]));
    children.push(esp(0.3));

    children.push(
        check([rn('Enero 2026 registró '), rb(fmt(D.kgExcel) + ' kg'), rn(' en báscula, un '),
            rb(Math.abs(D.varExcelDic).toFixed(1).replace('.', ',') + ' % menos'), rn(' que diciembre pero '),
            rb('prácticamente igual a enero 2025'), rn(' (–0,5 %), confirmando la estabilidad invernal.')]),
        check([rn('El sistema RFID registró '), rb(fmt(D.kgCamion) + ' kg'), rn(' en '),
            rb(fmt(D.salidas) + ' salidas'), rn(' (–' + Math.abs(D.varCamionDic).toFixed(0) + ' % vs diciembre), coherente con la reducción de frecuencias.')]),
        check([rn('La '), rb('orgánica supuso el 25,2 %'), rn(' del total RFID — porcentaje elevado para un mes de temporada baja, indicador de mejoras en la separación en origen.')]),
        check([rn('Los '), rb('campings'), rn(' (Edén, Vizmar, La Volta, El Cid) y el '),
            rb('Hotel Peñíscola Suites'), rn(' lideraron la generación hotelera en enero.')]),
        check([rn('El '), rb('CONTENEDOR RSU 1.100 TRASERA'), rn(' fue el más utilizado ('),
            rb(fmt(39372) + ' kg'), rn('), confirmando la adaptación operativa al patrón de temporada baja.')]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 4 — RESIDUOS POR HOTEL + GRÁFICO 1
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Residuos por hotel'));

    children.push(
        para([rn('En enero de 2026, la generación de residuos en la báscula municipal alcanzó los '),
            rb(fmt(D.kgExcel) + ' kg'), rn(', cifra prácticamente idéntica (–0,5 %) a la de enero de 2025 ('),
            rb(fmt(D.ene25_kgExcel) + ' kg'), rn('). Este resultado confirma la '),
            rb('estabilidad estructural del volumen invernal'), rn(', con niveles que se repiten año tras año dentro de los márgenes esperados para la temporada baja.')]),

        para([rn('El sector alojativo que mantiene actividad en enero está dominado por los '),
            rb('campings'), rn(', que permanecen abiertos a lo largo de todo el año. El '),
            rb('Camping Edén'), rn(' lideró con '), rb('5.610 kg'),
            rn(', seguido de '), rb('Camping Vizmar'), rn(' (3.190 kg), '),
            rb('Camping La Volta'), rn(' (2.885 kg) y '), rb('Camping El Cid'),
            rn(' (1.910 kg). En el segmento hotelero, el '),
            rb('Hotel Peñíscola Suites'), rn(' fue el único establecimiento con actividad relevante (3.860 kg), confirmando su operativa continua a lo largo del año.')]),
    );

    // Gráfico 1
    const g1 = imgCentrada(path.join(GRAFICOS,'g1_hoteles.png'), 160, 80, 'Gráfico 1. Top establecimientos generadores de residuos — Enero 2026');
    g1.forEach(e => children.push(e));

    children.push(
        para([rn('Las urbanizaciones '), rb('ATALAYAS'), rn(' (9.790 kg) y '), rb('SUBURBANO'),
            rn(' (5.270 kg) destacaron por encima de muchos campings, lo que refleja la actividad de '),
            rb('segunda residencia'), rn(' que se mantiene activa incluso en los meses más tranquilos del año. Esta distribución, muy diferente al patrón estival donde los grandes hoteles concentran cientos de miles de kilos, ilustra la '),
            rb('redistribución estacional'), rn(' de la generación entre los distintos tipos de establecimientos.')]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 5 — CONTENEDORES + GRÁFICO 2
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Residuos por tipo de contenedor'));

    children.push(
        para([rn('En enero de 2026, el '), rb('CONTENEDOR RSU 1.100 TRASERA'), rn(' lideró con '),
            rb(fmt(39372) + ' kg'), rn(', marcando un '),
            rb('cambio significativo respecto al patrón estival'),
            rn(' en el que los laterales de 2.200 y 3.200 litros dominan. Este resultado refleja que en temporada baja el sistema opera con contenedores de menor capacidad y mayor versatilidad, adaptados a la menor densidad de puntos de generación.')]),

        para([rn('El '), rb('RSU 800 TRASERA HOTELES'), rn(' acumuló '), rb(fmt(15085) + ' kg'),
            rn(' y la '), rb('ORGÁNICA 800L HOTELES'), rn(' registró '), rb(fmt(11781) + ' kg'),
            rn(', confirmando la actividad continua del sector alojativo activo. El '),
            rb('ORGÁNICA 1.100 TRASERA'), rn(' sumó ' + fmt(5394) + ' kg adicionales en orgánica, un nivel relevante para este mes.')]),
    );

    const g2 = imgCentrada(path.join(GRAFICOS,'g2_contenedores.png'), 160, 80, 'Gráfico 2. Residuos por tipo de contenedor — Enero 2026');
    g2.forEach(e => children.push(e));

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 6 — ZONAS + GRÁFICO 4
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Análisis por zonas geográficas'));

    children.push(
        para([rn('En enero, '), rb('Llandells – Estación'), rn(' (' + fmt(19994) + ' kg) y las '),
            rb('Urbanizaciones'), rn(' (' + fmt(18165) + ' kg) lideraron la distribución territorial, seguidas del '),
            rb('Centro Suburbano'), rn(' (' + fmt(12992) + ' kg) y la '),
            rb('Carretera Estación'), rn(' (' + fmt(11594) + ' kg). En temporada baja, el peso de las '),
            rb('zonas residenciales'), rn(' gana protagonismo frente a las áreas de alta densidad turística estival.')]),
    );

    const g4 = imgCentrada(path.join(GRAFICOS,'g4_zonas.png'), 160, 80, 'Gráfico 4. Residuos por zona geográfica — Enero 2026');
    g4.forEach(e => children.push(e));

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 7 — TIPO DE RESIDUO + GRÁFICO 3
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Análisis de tipo de residuo'));

    children.push(
        para([rn('La '), rb('fracción RSU'), rn(' concentró el '), rb('69,4 % (' + fmt(61196) + ' kg)'),
            rn(', mientras que la '), rb('orgánica'), rn(' alcanzó el '), rb('25,2 % (' + fmt(22236) + ' kg)'),
            rn('. Este porcentaje de orgánica es notablemente elevado para enero y puede indicar una mejora real en la separación en los establecimientos activos. Las fracciones reciclables —'),
            rb('envases (4,1 %)'), rn(' y '), rb('papel/cartón (1,3 %)'),
            rn('— se mantuvieron reducidas, propias de la baja actividad comercial y turística del mes.')]),
    );

    const g3 = imgCentrada(path.join(GRAFICOS,'g3_tipos.png'), 140, 100, 'Gráfico 3. Distribución por tipo de residuo — Enero 2026');
    g3.forEach(e => children.push(e));

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // PÁGINA 8 — COMPARATIVA + GRÁFICO 5
    // ══════════════════════════════════════════════════════════════════════
    children.push(seccion('Comparativa acumulada y evolución reciente'));

    children.push(
        para([rn('La comparativa de enero con los meses anteriores muestra el patrón estacional claramente: tras el '),
            rb('pico de octubre'), rn(' (' + fmt(821770) + ' kg) el sistema experimentó una caída progresiva en noviembre (536.480 kg) y diciembre (536.480 kg), ambos influenciados por la Navidad. Enero 2026 regresa a niveles similares a enero 2025 ('),
            rb('–0,5 %'), rn('), confirmando la solidez y predictibilidad del sistema.')]),
    );

    const g5 = imgCentrada(path.join(GRAFICOS,'g5_comparativa.png'), 160, 76, 'Gráfico 5. Evolución mensual de residuos — báscula municipal');
    g5.forEach(e => children.push(e));

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ══════════════════════════════════════════════════════════════════════
    // ANEXO — TABLAS DETALLADAS
    // ══════════════════════════════════════════════════════════════════════
    children.push(
        new Paragraph({
            spacing: { before: 0, after: 200 },
            shading: { fill: C_AZUL, type: ShadingType.CLEAR },
            children: [new TextRun({ text: '  ANEXO  ·  DATOS DETALLADOS — ENERO 2026', size: 28, bold: true, color: C_BLANCO, font: 'Calibri' })],
        }),
    );

    // Tabla 1 — KPIs generales
    children.push(subseccion('Tabla 1. Indicadores generales'));
    children.push(tablaData(
        ['Indicador', { label: 'Valor', right: true }],
        [
            ['Total recogido (báscula)',      fmt(D.kgExcel) + ' kg'],
            ['Total recogido (camión RFID)',  fmt(D.kgCamion) + ' kg'],
            ['Número de salidas del camión',  fmt(D.salidas)],
            ['% establecimientos hoteleros', D.pctHoteles.toFixed(1).replace('.', ',') + ' %'],
            ['Variación vs. diciembre 2025',  D.varExcelDic.toFixed(1).replace('.', ',') + ' % (báscula)'],
            ['Variación vs. enero 2025',      D.varExcelEne25.toFixed(1).replace('.', ',') + ' % (báscula)'],
            ['Vehículos distintos (RFID)',    String(D.matriculas.length)],
        ],
        [5500, 3526]
    ));
    children.push(esp());

    // Tabla 2 — Establecimientos
    children.push(subseccion('Tabla 2. Residuos por establecimiento (RFID)'));
    const totHot = D.hoteles.reduce((s, h) => s + h[2], 0);
    children.push(tablaData(
        ['Establecimiento', 'Tipo', { label: 'Kg', right: true }, { label: '% sobre total', right: true }],
        D.hoteles.map(([n, t, k]) => [n, t, fmt(k) + ' kg', (k/totHot*100).toFixed(1).replace('.', ',') + ' %']),
        [3200, 1800, 1500, 1526]
    ));
    children.push(esp());

    // Tabla 3 — Contenedores
    children.push(subseccion('Tabla 3. Residuos por tipo de contenedor (RFID)'));
    const totCont = D.contenedores.reduce((s, c) => s + c[1], 0);
    children.push(tablaData(
        ['Tipo de contenedor', { label: 'Kg', right: true }, { label: '% del total', right: true }],
        D.contenedores.map(([n, k]) => [n, fmt(k) + ' kg', (k/totCont*100).toFixed(1).replace('.', ',') + ' %']),
        [5200, 1700, 2126]
    ));
    children.push(esp());

    // Tabla 4 — Tipos de residuo
    children.push(subseccion('Tabla 4. Distribución por tipo de residuo (RFID)'));
    children.push(tablaData(
        ['Tipo de residuo', { label: 'Kg', right: true }, { label: '% del total RFID', right: true }],
        D.tipos.map(([n, k, p]) => [n, fmt(k) + ' kg', p.toFixed(1).replace('.', ',') + ' %']),
        [5000, 1700, 2326]
    ));
    children.push(esp());

    // Tabla 5 — Zonas
    children.push(subseccion('Tabla 5. Residuos por zona geográfica (RFID)'));
    const totZona = D.zonas.reduce((s, z) => s + z[1], 0);
    children.push(tablaData(
        ['Zona', { label: 'Kg', right: true }, { label: '% del total', right: true }],
        D.zonas.map(([n, k]) => [n, fmt(k) + ' kg', (k/totZona*100).toFixed(1).replace('.', ',') + ' %']),
        [5200, 1700, 2126]
    ));
    children.push(esp());

    // Tabla 6 — Matrículas
    children.push(subseccion('Tabla 6. Vehículos de recogida (RFID)'));
    const totMat = D.matriculas.reduce((s, m) => s + m[1], 0);
    children.push(tablaData(
        ['Matrícula', { label: 'Kg', right: true }, { label: '% del total', right: true }],
        D.matriculas.map(([n, k]) => [n, fmt(k) + ' kg', (k/totMat*100).toFixed(1).replace('.', ',') + ' %']),
        [3500, 2000, 3526]
    ));

    // ── Documento final ────────────────────────────────────────────────
    const doc = new Document({
        creator: 'Ajuntament de Peñíscola',
        title:   'Informe Residuos Enero 2026',
        subject: 'Residuos Sólidos Urbanos',
        styles: { default: { document: { run: { font: 'Calibri', size: 22, color: C_TEXTO } } } },
        sections: [{
            properties: {
                page: {
                    size:   { width: 11906, height: 16838 },
                    margin: { top: 1020, bottom: 1020, left: 1280, right: 1280 },
                },
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                            new TextRun({ text: 'Informe Residuos Enero 2026  ·  Pág. ', size: 16, color: C_GRIS, font: 'Calibri' }),
                            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C_GRIS, font: 'Calibri' }),
                        ],
                    })],
                }),
            },
            children,
        }],
    });

    const buf  = await Packer.toBuffer(doc);
    const out  = path.join(OUT_DIR, '2026_01_Informe_Residuos_Enero_2026_v2.docx');
    fs.writeFileSync(out, buf);
    console.log('Informe generado:', out);
    console.log('Tamaño:', (buf.length / 1024).toFixed(0), 'KB');
}

generarInforme().catch(e => { console.error('Error:', e.message); process.exit(1); });
