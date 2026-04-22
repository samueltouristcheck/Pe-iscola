/**
 * Extrae la imagen de portada de un informe Word y la guarda como informes_ejemplo/portada.jpg
 * Uso: node extraer_portada.js
 * O:   node extraer_portada.js "ruta\al\informe.docx"
 */
const fs = require('fs');
const path = require('path');

const docxPath = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', 'Peñiscola', 'Informes', '2025', '02 - Febrero 2025', 'Informe Residuos Febrero- Mes.docx');
const destDir = path.join(__dirname, 'informes_ejemplo');
const destPath = path.join(destDir, 'portada.jpg');

if (!fs.existsSync(docxPath)) {
    console.error('No se encontró:', docxPath);
    console.log('Copia manualmente la imagen de portada a informes_ejemplo/portada.jpg');
    process.exit(1);
}

try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(docxPath);
    const entries = zip.getEntries();
    const imgEntry = entries.find(e => e.entryName.match(/word[\\\/]media[\\\/].+\.(jpg|jpeg|png)$/i));
    if (imgEntry) {
        fs.mkdirSync(destDir, { recursive: true });
        const ext = path.extname(imgEntry.entryName).toLowerCase();
        const finalDest = ext === '.png' ? path.join(destDir, 'portada.png') : destPath;
        fs.writeFileSync(finalDest, imgEntry.getData());
        console.log('Portada guardada en:', finalDest);
    } else {
        console.error('No se encontró imagen. Copia portada.jpg manualmente a informes_ejemplo/');
    }
} catch (err) {
    console.error(err.message);
    console.log('Instala: npm install adm-zip');
    console.log('O copia la imagen manualmente a informes_ejemplo/portada.jpg');
}
