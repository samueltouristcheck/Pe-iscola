'use strict';
/**
 * Genera el informe de Enero 2026 en formato Word (.docx)
 * Estilo idéntico a los PDFs de ejemplo (texto narrativo largo, negritas, ✓ aspectos clave)
 */
const fs   = require('fs');
const path = require('path');
const {
    Document, Packer, Paragraph, TextRun, ImageRun,
    AlignmentType, PageBreak, HeadingLevel, ShadingType,
    Header, Footer, PageNumber, BorderStyle, WidthType,
    Table, TableRow, TableCell, VerticalAlign
} = require('docx');

const OUT_DIR = path.join(__dirname, 'informes_generados');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PORTADA_PATH = (() => {
    for (const n of ['Imagen_portada.png','imagen_portada.png','portada.png','portada.jpg']) {
        const p = path.join(__dirname, 'informes_ejemplo', n);
        if (fs.existsSync(p)) return p;
    }
    return null;
})();

// ── Helpers tipográficos ─────────────────────────────────────────────────
const COLOR_AZUL = '1B3A6B';
const r  = (text, opts={}) => new TextRun({ text: String(text), size: 22, font: 'Calibri', ...opts });
const rb = (text, opts={}) => new TextRun({ text: String(text), size: 22, font: 'Calibri', bold: true, ...opts });
const ri = (text, opts={}) => new TextRun({ text: String(text), size: 22, font: 'Calibri', italics: true, ...opts });

// Párrafo normal con spacing
function para(runs, opts={}) {
    return new Paragraph({
        spacing: { after: 180, line: 288 },
        ...opts,
        children: Array.isArray(runs) ? runs : [r(runs)],
    });
}

// Título de sección con línea inferior azul
function seccion(texto) {
    return new Paragraph({
        spacing: { before: 400, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_AZUL, space: 4 } },
        children: [new TextRun({ text: texto, size: 28, bold: true, color: COLOR_AZUL, font: 'Calibri' })],
    });
}

// Ítem con ✓
function check(runs) {
    return new Paragraph({
        spacing: { before: 120, after: 120 },
        indent: { left: 200 },
        children: [
            new TextRun({ text: '✓  ', size: 22, bold: true, color: COLOR_AZUL, font: 'Calibri' }),
            ...(Array.isArray(runs) ? runs : [r(runs)]),
        ],
    });
}

function espacio(n=1) {
    return new Paragraph({ spacing: { after: n * 100 }, children: [] });
}

// ── DATOS DE ENERO 2026 ──────────────────────────────────────────────────
// Fuente: /api/residuos/informe-data?mes=2026-01
const D = {
    // Enero 2026
    kgExcel:   468740,   // báscula (fuente principal)
    kgCamion:   88187,   // RFID camión
    salidas:     1883,

    // Diciembre 2025
    dic_kgExcel:  536480,
    dic_kgCamion: 244749,
    dic_salidas:    3430,

    // Enero 2025 (RFID muy limitado ese mes — sistema recién implantado)
    ene25_kgExcel:  471240,
    ene25_kgCamion:   4399,   // datos incompletos

    // Top establecimientos (RFID)
    hoteles: [
        { nombre: 'ATALAYAS',               kg: 9790  },
        { nombre: 'Camping Edén',            kg: 5610  },
        { nombre: 'SUBURBANO',               kg: 5270  },
        { nombre: 'Hotel Peñíscola Suites',  kg: 3860  },
        { nombre: 'URMI',                    kg: 4035  },
        { nombre: 'Camping Vizmar',          kg: 3190  },
        { nombre: 'Camping La Volta',        kg: 2885  },
        { nombre: 'CAMPING EL CID',          kg: 1910  },
    ],

    // Contenedores
    contenedores: [
        { nombre: 'CONTENEDOR RSU 1.100 TRASERA',          kg: 39372 },
        { nombre: 'CONTENEDOR RSU 800 TRASERA HOTELES',    kg: 15085 },
        { nombre: 'CONTENEDOR ORGÁNICA 800l. HOTELES',     kg: 11781 },
        { nombre: 'CONTENEDOR ORGÁNICA 1.100 TRASERA',     kg:  5394 },
        { nombre: 'CONTENEDOR ENVASES 800l. HOTELES',      kg:  2015 },
        { nombre: 'CONTENEDOR RSU 3.200 LATERAL',          kg:  1360 },
    ],

    // Zonas
    zonas: [
        { nombre: 'Llandells - Estación',   kg: 19994 },
        { nombre: 'Urbanizaciones',          kg: 18165 },
        { nombre: 'Centro Suburbano',        kg: 12992 },
        { nombre: 'Carretera Estación',      kg: 11594 },
        { nombre: 'Zona Norte 1',            kg: 11520 },
        { nombre: 'Zona Norte Interior',     kg:  8247 },
        { nombre: 'Casco Antiguo',           kg:   904 },
    ],

    // Tipos de residuo
    tipos: [
        { nombre: 'Mezcla de residuos municipales (RSU)', kg: 61196, pct: 69.4 },
        { nombre: 'Orgánica',                             kg: 22236, pct: 25.2 },
        { nombre: 'Envases mezclados',                    kg:  3585, pct:  4.1 },
        { nombre: 'Papel y cartón',                       kg:  1170, pct:  1.3 },
    ],

    pctHoteles: 66.8,  // % de kgCamion que son establecimientos
};

const fmt = (n) => Math.round(n).toLocaleString('es-ES');

// Variaciones porcentuales
const varExcelDic  = ((D.kgExcel - D.dic_kgExcel) / D.dic_kgExcel * 100);   // -12.6%
const varExcelEne25 = ((D.kgExcel - D.ene25_kgExcel) / D.ene25_kgExcel * 100); // -0.5%
const varCamionDic  = ((D.kgCamion - D.dic_kgCamion) / D.dic_kgCamion * 100); // -64%
const varSalidasDic = ((D.salidas - D.dic_salidas) / D.dic_salidas * 100);    // -45%

const pct = (n) => (n >= 0 ? '+' : '') + Math.abs(n).toFixed(2).replace('.', ',') + ' %';

// ── Contenido del informe ────────────────────────────────────────────────
async function generarInforme() {
    const children = [];

    // ── PORTADA ────────────────────────────────────────────────────────
    if (PORTADA_PATH) {
        const ext = path.extname(PORTADA_PATH).toLowerCase();
        const buf = fs.readFileSync(PORTADA_PATH);
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new ImageRun({
                type: (ext === '.jpg' || ext === '.jpeg') ? 'jpg' : 'png',
                data: buf,
                transformation: { width: 600, height: 360 },
                altText: { title: 'Portada', description: 'Imagen portada Peñíscola', name: 'portada' },
            })],
        }));
    }

    const shadAzul = { fill: COLOR_AZUL, type: ShadingType.CLEAR };
    children.push(
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: PORTADA_PATH ? 60 : 400, after: 0 }, shading: shadAzul, children: [new TextRun({ text: 'INFORME', size: 60, bold: true, color: 'FFFFFF', font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadAzul, children: [new TextRun({ text: 'RESIDUOS', size: 60, bold: true, color: 'FFFFFF', font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadAzul, children: [new TextRun({ text: 'ENERO   2026', size: 34, bold: true, color: 'A8C8FF', font: 'Calibri' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, shading: shadAzul, children: [new TextRun({ text: 'Ajuntament de Peñíscola', size: 22, color: 'C8D8F0', italics: true, font: 'Calibri' })] }),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 2: RESUMEN GENERAL ──────────────────────────────────────
    children.push(
        para([
            r('Enero de 2026 se confirma como un mes de '),
            rb('temporada baja profunda'),
            r(' en Peñíscola, con una reducción sustancial en los volúmenes de residuos respecto a diciembre y un comportamiento prácticamente idéntico al de enero del año anterior. En total, el sistema de báscula registró '),
            rb(fmt(D.kgExcel) + ' kg'),
            r(', un '),
            rb(Math.abs(varExcelDic).toFixed(2).replace('.', ',') + ' % menos'),
            r(' que en diciembre de 2025 (' + fmt(D.dic_kgExcel) + ' kg), y solo un '),
            rb(Math.abs(varExcelEne25).toFixed(2).replace('.', ',') + ' % menos'),
            r(' que en enero de 2025 (' + fmt(D.ene25_kgExcel) + ' kg), lo que confirma la '),
            rb('estabilidad estructural del servicio'),
            r(' en el periodo invernal y la regularidad del sistema de gestión municipal. Por su parte, el sistema RFID del camión contabilizó '),
            rb(fmt(D.kgCamion) + ' kg'),
            r(' en '),
            rb(fmt(D.salidas) + ' salidas'),
            r(', una reducción del '),
            rb(Math.abs(varCamionDic).toFixed(1).replace('.', ',') + ' %'),
            r(' respecto a diciembre, coherente con el ajuste de frecuencias y rutas propio de la temporada baja.'),
        ]),

        para([
            r('En el ámbito hotelero, los '),
            rb('campings'),
            r(' mantuvieron niveles de actividad destacados durante el mes de enero, con el '),
            rb('Camping Edén'),
            r(' como principal generador de su categoría con '),
            rb(fmt(D.hoteles[1].kg) + ' kg'),
            r(', seguido de '),
            rb('Camping Vizmar'),
            r(' (' + fmt(D.hoteles[5].kg) + ' kg) y '),
            rb('Camping La Volta'),
            r(' (' + fmt(D.hoteles[6].kg) + ' kg). En el segmento hotelero, el '),
            rb('Hotel Peñíscola Suites'),
            r(' lideró con '),
            rb(fmt(D.hoteles[3].kg) + ' kg'),
            r(', mientras que las urbanizaciones ATALAYAS (' + fmt(D.hoteles[0].kg) + ' kg) y SUBURBANO (' + fmt(D.hoteles[2].kg) + ' kg) aportaron volúmenes relevantes para el período. En conjunto, los establecimientos identificados por el sistema RFID representaron el '),
            rb(D.pctHoteles.toFixed(1).replace('.', ',') + ' %'),
            r(' del total recogido por el camión.'),
        ]),

        para([
            r('En cuanto a la infraestructura de recogida, enero marcó un '),
            rb('cambio significativo respecto a los meses de verano'),
            r(': el '),
            rb('CONTENEDOR RSU 1.100 TRASERA'),
            r(' pasó a encabezar la lista con '),
            rb(fmt(D.contenedores[0].kg) + ' kg'),
            r(', desplazando a los grandes contenedores laterales de 2.200 y 3.200 litros, que dominan durante la temporada alta. Este patrón refleja la menor densidad turística y la adaptación del servicio a las necesidades reales del municipio en invierno. El '),
            rb('RSU 800 TRASERA HOTELES'),
            r(' acumuló ' + fmt(D.contenedores[1].kg) + ' kg y la '),
            rb('ORGÁNICA 800L HOTELES'),
            r(' registró ' + fmt(D.contenedores[2].kg) + ' kg, confirmando la actividad continua del sector alojativo.'),
        ]),

        para([
            r('Por zonas, '),
            rb('Llandells – Estación'),
            r(' (' + fmt(D.zonas[0].kg) + ' kg) y las '),
            rb('Urbanizaciones'),
            r(' (' + fmt(D.zonas[1].kg) + ' kg) lideraron la generación, seguidas por el '),
            rb('Centro Suburbano'),
            r(' (' + fmt(D.zonas[2].kg) + ' kg) y la '),
            rb('Carretera Estación'),
            r(' (' + fmt(D.zonas[3].kg) + ' kg). Este reparto confirma que en temporada baja el peso de las '),
            rb('zonas residenciales y de servicios'),
            r(' gana protagonismo frente a las áreas de alta densidad turística estival, donde la actividad se concentra en el núcleo urbano consolidado.'),
        ]),

        para([
            r('Por fracciones, la '),
            rb('mezcla de residuos municipales (RSU)'),
            r(' siguió siendo predominante con '),
            rb(fmt(D.tipos[0].kg) + ' kg (' + D.tipos[0].pct.toFixed(1).replace('.', ',') + ' %)'),
            r(', mientras que la '),
            rb('fracción orgánica'),
            r(' alcanzó los '),
            rb(fmt(D.tipos[1].kg) + ' kg'),
            r(', equivalente al '),
            rb(D.tipos[1].pct.toFixed(1).replace('.', ',') + ' %'),
            r(' del total. Este porcentaje de orgánica es notablemente elevado para un mes de temporada baja y puede ser indicador de una mejora en la separación en origen en los establecimientos activos. Las fracciones reciclables —'),
            rb('envases (' + fmt(D.tipos[2].kg) + ' kg)'),
            r(' y '),
            rb('papel/cartón (' + fmt(D.tipos[3].kg) + ' kg)'),
            r('— se mantuvieron en niveles reducidos, propios de la escasa actividad comercial y turística de enero.'),
        ]),
    );

    children.push(seccion('RESUMEN GENERAL'));
    children.push(espacio());
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 3: CONCLUSIONES ─────────────────────────────────────────
    children.push(seccion('Conclusiones:'));

    children.push(
        para([
            r('En enero de 2026, Peñíscola confirmó el comportamiento esperado de la '),
            rb('temporada baja profunda'),
            r(', con unos '),
            rb(fmt(D.kgExcel) + ' kg'),
            r(' recogidos en báscula que representan una caída del '),
            rb(Math.abs(varExcelDic).toFixed(2).replace('.', ',') + ' %'),
            r(' respecto a diciembre, pero una variación casi nula frente a enero de 2025 ('),
            rb(pct(varExcelEne25)),
            r('), lo que evidencia la madurez y regularidad del sistema de gestión municipal. La '),
            rb('estabilidad interanual'),
            r(' es la nota dominante del mes: el municipio mantiene sus niveles de generación habituales de invierno, con el servicio correctamente dimensionado para dar respuesta a la demanda real.'),
        ]),

        para([
            r('La reducción del '),
            rb(Math.abs(varCamionDic).toFixed(1).replace('.', ',') + ' %'),
            r(' en el sistema camión respecto a diciembre obedece al ajuste natural de '),
            rb('frecuencias y rutas de recogida'),
            r(' en la transición hacia la temporada baja, pasando de '),
            rb(fmt(D.dic_salidas) + ' salidas'),
            r(' en diciembre a '),
            rb(fmt(D.salidas) + ' salidas'),
            r(' en enero. La actividad se concentra en los establecimientos que permanecen abiertos durante el invierno, fundamentalmente campings y un grupo reducido de hoteles. Destaca positivamente el '),
            rb('elevado porcentaje de fracción orgánica'),
            r(' (' + D.tipos[1].pct.toFixed(1).replace('.', ',') + ' % del total RFID), que sugiere un avance en la separación en origen en los establecimientos en activo.'),
        ]),
    );

    children.push(espacio());
    children.push(para([rb('Aspectos Clave:')]));
    children.push(espacio(0.5));

    children.push(
        check([
            r('Enero 2026 registró '),
            rb(fmt(D.kgExcel) + ' kg'),
            r(' en báscula, un '),
            rb(Math.abs(varExcelDic).toFixed(1).replace('.', ',') + ' % menos'),
            r(' que en diciembre pero '),
            rb('prácticamente igual a enero 2025'),
            r(' (–0,5 %), confirmando la estabilidad invernal del sistema.'),
        ]),
        check([
            r('El sistema RFID registró '),
            rb(fmt(D.kgCamion) + ' kg'),
            r(' en '),
            rb(fmt(D.salidas) + ' salidas'),
            r(', un '),
            rb(Math.abs(varCamionDic).toFixed(1).replace('.', ',') + ' % menos'),
            r(' que en diciembre, coherente con la reducción de frecuencias de la temporada baja.'),
        ]),
        check([
            r('La '),
            rb('orgánica representó el ' + D.tipos[1].pct.toFixed(1).replace('.', ',') + ' %'),
            r(' del total RFID, porcentaje elevado para un mes de temporada baja que puede indicar '),
            rb('mejoras en la separación en origen'),
            r(' en los establecimientos activos.'),
        ]),
        check([
            r('Los '),
            rb('campings'),
            r(' (Camping Edén, Camping Vizmar, Camping La Volta y Camping El Cid) y el '),
            rb('Hotel Peñíscola Suites'),
            r(' lideraron la generación hotelera, confirmando su actividad durante el periodo invernal.'),
        ]),
        check([
            r('El '),
            rb('CONTENEDOR RSU 1.100 TRASERA'),
            r(' fue el más utilizado (' + fmt(D.contenedores[0].kg) + ' kg), desplazando a los grandes contenedores laterales propios del verano, y confirmando la '),
            rb('adaptación operativa al patrón de temporada baja'),
            r('.'),
        ]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 4: RESIDUOS POR HOTEL ───────────────────────────────────
    children.push(seccion('Residuos por hotel'));

    children.push(
        para([
            r('En enero de 2026, la generación total de residuos registrada por la báscula municipal alcanzó los '),
            rb(fmt(D.kgExcel) + ' kilogramos'),
            r(', una cifra que se sitúa un '),
            rb(Math.abs(varExcelEne25).toFixed(2).replace('.', ',') + ' % por debajo'),
            r(' del mismo mes del año anterior (' + fmt(D.ene25_kgExcel) + ' kg). Esta mínima variación confirma la '),
            rb('estabilidad en la generación de residuos durante la temporada baja'),
            r(', con volúmenes que se mantienen dentro de los márgenes habituales del periodo invernal. El dato sugiere que, aunque la actividad turística desciende drásticamente en enero, el consumo residencial y de los establecimientos en funcionamiento mantiene un nivel base constante y predecible.'),
        ]),

        para([
            r('El contraste con diciembre de 2025 —cuando se alcanzaron '),
            rb(fmt(D.dic_kgExcel) + ' kg'),
            r('— pone de manifiesto el impacto del '),
            rb('periodo navideño'),
            r(' en la generación de residuos, especialmente en fracciones como envases y papel/cartón, que en diciembre se dispararon por las compras y el consumo festivo. Enero, por tanto, representa la '),
            rb('vuelta a la normalidad invernal'),
            r(', con un perfil de residuos mucho más concentrado en RSU y orgánica.'),
        ]),

        para([
            r('El sistema RFID del camión registró '),
            rb(fmt(D.kgCamion) + ' kg'),
            r(' en '),
            rb(fmt(D.salidas) + ' salidas'),
            r('. En el análisis por establecimientos, la generación se concentró en un grupo reducido de '),
            rb('campings y hoteles'),
            r(' que mantienen actividad durante el invierno. En el segmento de campings, el '),
            rb('Camping Edén'),
            r(' lideró con '),
            rb(fmt(D.hoteles[1].kg) + ' kg'),
            r(', consolidándose una vez más como el establecimiento de camping con mayor volumen del municipio incluso en temporada baja. Le siguieron el '),
            rb('Camping Vizmar'),
            r(' con ' + fmt(D.hoteles[5].kg) + ' kg, '),
            rb('Camping La Volta'),
            r(' con ' + fmt(D.hoteles[6].kg) + ' kg y el '),
            rb('Camping El Cid'),
            r(' con ' + fmt(D.hoteles[7].kg) + ' kg.'),
        ]),

        para([
            r('En el segmento hotelero, el '),
            rb('Hotel Peñíscola Suites'),
            r(' volvió a destacar como el mayor generador individual con '),
            rb(fmt(D.hoteles[3].kg) + ' kg'),
            r(', lo que confirma su posición como uno de los pocos establecimientos que mantiene ocupación y servicio activo durante los meses de invierno. Las urbanizaciones residenciales '),
            rb('ATALAYAS'),
            r(' (' + fmt(D.hoteles[0].kg) + ' kg), '),
            rb('SUBURBANO'),
            r(' (' + fmt(D.hoteles[2].kg) + ' kg) y '),
            rb('URMI'),
            r(' (' + fmt(D.hoteles[4].kg) + ' kg) también aportaron volúmenes destacados, fruto de la actividad de segunda residencia que se concentra en estas zonas.'),
        ]),

        para([
            r('Estos datos confirman que, durante enero, la '),
            rb('presión sobre el sistema de recogida se redistribuye'),
            r(' respecto a los meses de verano: en lugar de concentrarse en los grandes hoteles de la primera línea, se extiende de forma más homogénea entre los campings activos, los establecimientos residenciales y los hoteles de apertura continuada. Esta redistribución facilita la gestión operativa y permite '),
            rb('optimizar recursos'),
            r(' sin comprometer la calidad del servicio.'),
        ]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 5: RESIDUOS POR CONTENEDOR ─────────────────────────────
    children.push(seccion('Residuos por tipo de contenedor'));

    children.push(
        para([
            r('En enero de 2026, el '),
            rb('CONTENEDOR RSU 1.100 TRASERA'),
            r(' se posicionó como el punto de recogida con mayor volumen de residuos, acumulando '),
            rb(fmt(D.contenedores[0].kg) + ' kg'),
            r('. Este resultado representa un '),
            rb('cambio significativo respecto al patrón estival'),
            r(', cuando los contenedores laterales de gran capacidad (2.200 y 3.200 litros) dominan la infraestructura. En temporada baja, los contenedores de menor capacidad y mayor versatilidad logística se convierten en los protagonistas del sistema, reflejando el ajuste del servicio a la demanda real del municipio.'),
        ]),

        para([
            r('En segunda posición se situó el '),
            rb('CONTENEDOR RSU 800 TRASERA HOTELES'),
            r(' con '),
            rb(fmt(D.contenedores[1].kg) + ' kg'),
            r(', seguido de la '),
            rb('ORGÁNICA 800L HOTELES'),
            r(' con '),
            rb(fmt(D.contenedores[2].kg) + ' kg'),
            r('. La relevancia de los contenedores específicos para hoteles en plena temporada baja demuestra que el '),
            rb('sector alojativo activo'),
            r(' —principalmente campings y los hoteles de apertura continuada— mantiene un flujo constante de residuos, especialmente en la fracción orgánica, lo que refuerza la importancia de estos equipos en la planificación operativa anual.'),
        ]),

        para([
            r('El '),
            rb('CONTENEDOR ORGÁNICA 1.100 TRASERA'),
            r(' registró ' + fmt(D.contenedores[3].kg) + ' kg, un nivel destacado para un mes de baja actividad, mientras que los '),
            rb('ENVASES 800L HOTELES'),
            r(' acumularon ' + fmt(D.contenedores[4].kg) + ' kg. Estos valores, aunque modestos en términos absolutos, son coherentes con la actividad de los establecimientos en funcionamiento y confirman que la recogida selectiva se mantiene operativa incluso en los meses de menor presión turística.'),
        ]),

        para([
            r('El '),
            rb('CONTENEDOR RSU 3.200 LATERAL'),
            r(', que en verano llega a superar los 500.000 kg mensuales, apenas acumuló '),
            rb(fmt(D.contenedores[5].kg) + ' kg'),
            r(' en enero. Esta reducción, de más del 99 % respecto a los picos estivales, ilustra con claridad la '),
            rb('estacionalidad del sistema'),
            r(' y la necesidad de una planificación de recursos flexible que se adapte al ritmo real de la actividad municipal a lo largo del año.'),
        ]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 6: ZONAS GEOGRÁFICAS ────────────────────────────────────
    children.push(seccion('Análisis por zonas geográficas'));

    children.push(
        para([
            r('Durante el mes de enero de 2026, la distribución territorial de los residuos en Peñíscola reflejó el patrón propio de la temporada baja, con una '),
            rb('redistribución del peso relativo'),
            r(' de las diferentes zonas respecto a los meses de verano. '),
            rb('Llandells – Estación'),
            r(' encabezó el ranking con '),
            rb(fmt(D.zonas[0].kg) + ' kg'),
            r(', seguida de cerca por las '),
            rb('Urbanizaciones'),
            r(' con '),
            rb(fmt(D.zonas[1].kg) + ' kg'),
            r('. Ambas zonas concentran una parte significativa de la segunda residencia y los establecimientos de alojamiento activos en invierno, lo que explica su posición destacada incluso en ausencia de la presión turística estival.'),
        ]),

        para([
            r('En segunda franja se situaron el '),
            rb('Centro Suburbano'),
            r(' (' + fmt(D.zonas[2].kg) + ' kg), la '),
            rb('Carretera Estación'),
            r(' (' + fmt(D.zonas[3].kg) + ' kg) y la '),
            rb('Zona Norte 1'),
            r(' (' + fmt(D.zonas[4].kg) + ' kg), que mantuvieron una actividad moderada y coherente con la dinámica residencial invernal. La '),
            rb('Zona Norte Interior'),
            r(' (' + fmt(D.zonas[5].kg) + ' kg) completó el conjunto de zonas con mayor actividad relativa, mientras que el '),
            rb('Casco Antiguo'),
            r(' (' + fmt(D.zonas[6].kg) + ' kg) registró el menor volumen, lo que refleja tanto las restricciones de acceso propias del casco histórico como el bajo nivel de actividad residencial en esta área durante el invierno.'),
        ]),

        para([
            r('Este reparto contrasta con los meses de verano, en los que '),
            rb('Zona Norte – Peñísmar'),
            r(' y '),
            rb('Zona Norte 1'),
            r(' lideran con amplísima ventaja por la concentración de establecimientos hoteleros. En enero, la '),
            rb('distribución es significativamente más homogénea'),
            r(', lo que facilita la optimización de rutas y permite al servicio de recogida operar con mayor eficiencia y menor coste logístico. El patrón confirma la necesidad de mantener una planificación operativa estacional que contemple estas variaciones territoriales.'),
        ]),
    );

    children.push(new Paragraph({ children: [new PageBreak()] }));

    // ── PÁGINA 7: TIPO DE RESIDUO ──────────────────────────────────────
    children.push(seccion('Análisis de tipo de residuo'));

    const kgRFIDTotal = D.tipos.reduce((s, t) => s + t.kg, 0);

    children.push(
        para([
            r('En el mes de enero de 2026, el sistema RFID del camión registró un total de '),
            rb(fmt(D.kgCamion) + ' kilogramos'),
            r(' de residuos, una cifra que, aunque significativamente inferior a los meses de verano, refleja de forma fiel la '),
            rb('actividad base del municipio'),
            r(' durante la temporada baja profunda. La distribución por fracciones ofrece una lectura interesante respecto a los meses anteriores, con una '),
            rb('mayor proporción relativa de fracción orgánica'),
            r(' que puede estar indicando avances en la separación en origen.'),
        ]),

        para([
            r('La '),
            rb('fracción de Residuos Sólidos Urbanos (RSU)'),
            r(' siguió siendo la predominante, con '),
            rb(fmt(D.tipos[0].kg) + ' kg'),
            r(', equivalente al '),
            rb(D.tipos[0].pct.toFixed(1).replace('.', ',') + ' % del total'),
            r('. Aunque continúa representando más de dos tercios del volumen, su proporción es '),
            rb('notablemente inferior'),
            r(' a la de los picos estivales, donde la RSU suele superar el 70-72 %. Esta diferencia puede estar vinculada a una menor generación de residuos mixtos sin clasificar en el contexto de baja actividad turística.'),
        ]),

        para([
            r('En segundo lugar, la '),
            rb('fracción orgánica'),
            r(' alcanzó los '),
            rb(fmt(D.tipos[1].kg) + ' kg'),
            r(', lo que supone el '),
            rb(D.tipos[1].pct.toFixed(1).replace('.', ',') + ' % del total'),
            r('. Este porcentaje resulta '),
            rb('especialmente destacado para un mes de enero'),
            r(', ya que en temporada baja la actividad de restauración y los residuos alimentarios de los establecimientos hoteleros se reducen considerablemente. Su mantenimiento en niveles significativos apunta a una '),
            rb('mejora en la separación'),
            r(' por parte de los establecimientos activos —principalmente campings— y puede ser el resultado de los esfuerzos de sensibilización llevados a cabo durante 2025.'),
        ]),

        para([
            r('Las fracciones de '),
            rb('envases mezclados (' + fmt(D.tipos[2].kg) + ' kg; ' + D.tipos[2].pct.toFixed(1).replace('.', ',') + ' %)'),
            r(' y '),
            rb('papel/cartón (' + fmt(D.tipos[3].kg) + ' kg; ' + D.tipos[3].pct.toFixed(1).replace('.', ',') + ' %)'),
            r(' se mantuvieron en niveles muy reducidos, propios de la escasa actividad comercial y turística del mes. Es significativo comparar estos datos con diciembre de 2025, cuando los envases alcanzaron los '),
            rb('114.040 kg'),
            r(' por el impacto de las compras y el consumo navideño. El retorno a niveles bajos en enero confirma que el '),
            rb('efecto estacional sobre las fracciones reciclables'),
            r(' es muy marcado en Peñíscola y debe tenerse en cuenta a la hora de planificar la capacidad de los contenedores selectivos.'),
        ]),

        para([
            r('Estos resultados evidencian que, aunque la fracción resto sigue siendo claramente dominante, enero de 2026 mostró una '),
            rb('composición de residuos más equilibrada'),
            r(' que en los picos estivales, con una mayor contribución relativa de la orgánica. Este dato, unido a la estabilidad interanual en el volumen total, refuerza la imagen de un sistema de gestión de residuos '),
            rb('maduro, eficiente y adaptado'),
            r(' a las características estacionales de Peñíscola. El reto para los próximos meses será '),
            rb('mantener y ampliar'),
            r(' los avances en la recogida selectiva cuando la presión turística vuelva a incrementarse a partir de la primavera.'),
        ]),
    );

    // ── Documento final ───────────────────────────────────────────────
    const doc = new Document({
        creator:  'Ajuntament de Peñíscola',
        title:    'Informe Residuos Enero 2026',
        subject:  'Residuos Sólidos Urbanos',
        styles: {
            default: {
                document: { run: { font: 'Calibri', size: 22 } },
            },
        },
        sections: [{
            properties: {
                page: {
                    size:   { width: 11906, height: 16838 },
                    margin: { top: 1134, bottom: 1134, left: 1280, right: 1280 },
                },
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                            new TextRun({ text: 'Informe Residuos Enero 2026  ·  Pág. ', size: 16, color: '888888', font: 'Calibri' }),
                            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888', font: 'Calibri' }),
                        ],
                    })],
                }),
            },
            children,
        }],
    });

    const buf  = await Packer.toBuffer(doc);
    const out  = path.join(OUT_DIR, '2026_01_Informe_Residuos_Enero_2026.docx');
    fs.writeFileSync(out, buf);
    console.log('✅ Informe generado:', out);
    console.log('   Tamaño:', (buf.length / 1024).toFixed(1), 'KB');
}

generarInforme().catch((e) => { console.error('❌', e.message); process.exit(1); });
