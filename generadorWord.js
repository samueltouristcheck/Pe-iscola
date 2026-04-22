/**
 * Genera informe Word (.docx) con portada y contenido.
 * Portada: imagen Imagen_portada.png (o portada.png/jpg) + título.
 */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, PageBreak, HeadingLevel, ShadingType } = require('docx');

const EJEMPLOS_DIR = path.join(__dirname, 'informes_ejemplo');

function getRutaPortada() {
  const candidatos = [
    path.join(EJEMPLOS_DIR, 'Imagen_portada.png'),
    path.join(EJEMPLOS_DIR, 'imagen_portada.png'),
    path.join(EJEMPLOS_DIR, 'portada.png'),
    path.join(EJEMPLOS_DIR, 'portada.jpg'),
  ];
  for (const p of candidatos) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function generarDocx(data, reportTxt) {
  const periodoLabel = (data.periodoLabel || '').toUpperCase();
  const rutaPortada = getRutaPortada();
  const fmt = (n) => (n ?? 0).toLocaleString('es-ES');

  const children = [];

  // --- PORTADA: imagen mitad superior + título en bloque verde ---
  if (rutaPortada) {
    const ext = path.extname(rutaPortada).toLowerCase();
    const tipo = ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'png';
    const imgBuffer = fs.readFileSync(rutaPortada);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [
          new ImageRun({
            type: tipo,
            data: imgBuffer,
            transformation: { width: 500, height: 320 },
          }),
        ],
      })
    );
  }

  const shadVerde = { fill: '00C9A7', type: ShadingType.CLEAR };
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: rutaPortada ? 80 : 200, after: 60 },
      shading: shadVerde,
      children: [new TextRun({ text: periodoLabel, size: 26, bold: true, color: 'FFFFFF' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      shading: shadVerde,
      children: [new TextRun({ text: 'INFORME', size: 44, bold: true, color: 'FFFFFF' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: rutaPortada ? 200 : 400 },
      shading: shadVerde,
      children: [new TextRun({ text: 'RESIDUOS', size: 44, bold: true, color: 'FFFFFF' })],
    })
  );

  if (!rutaPortada) {
    children.length = 0;
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 60 },
        children: [new TextRun({ text: periodoLabel, size: 28, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: [new TextRun({ text: 'INFORME', size: 48, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: 'RESIDUOS', size: 48, bold: true })],
      })
    );
  }

  // Salto de página y contenido
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'RESUMEN GENERAL', bold: true })],
    })
  );

  const lineas = reportTxt.split('\n');
  for (const linea of lineas) {
    const t = linea.trim();
    if (!t) continue;
    if (t.startsWith('RESIDUOS POR') || t.startsWith('TIPOS DE') || t.startsWith('CONCLUSIONES')) {
      children.push(
        new Paragraph({
          spacing: { before: 300 },
          children: [new TextRun({ text: t, bold: true, size: 24 })],
        })
      );
    } else if (t.startsWith('- ')) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          children: [new TextRun({ text: t })],
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: t })],
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generarDocx, getRutaPortada };
