const mammoth = require('mammoth');
const fs = require('fs');

const docPath = 'C:\\Users\\touri\\Desktop\\Peñiscola\\Informes\\2025\\02 - Febrero 2025\\Informe Residuos Febrero- Mes.docx';

mammoth.convertToHtml({ path: docPath })
  .then(result => {
    let html = result.value;
    html = html.replace(/src="data:image\/[^"]+"/g, 'src="[IMAGE_EMBEDDED]"');
    const firstPart = html.substring(0, 1200);
    console.log('=== COVER PAGE STRUCTURE (HTML) ===');
    console.log(firstPart);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
