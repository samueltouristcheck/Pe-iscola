const mammoth = require('mammoth');
const path = require('path');

const docPath = 'C:\\Users\\touri\\Desktop\\Peñiscola\\Informes\\2025\\02 - Febrero 2025\\Informe Residuos Febrero- Mes.docx';

mammoth.convertToHtml({ path: docPath })
  .then(result => {
    const html = result.value;
    const firstPart = html.substring(0, 1500);
    console.log('=== HTML structure (first ~1500 chars of cover) ===');
    console.log(firstPart);
    console.log('\n--- Messages:', JSON.stringify(result.messages, null, 2));
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
