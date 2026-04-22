const mammoth = require('mammoth');
const path = require('path');

const docPath = 'C:\\Users\\touri\\Desktop\\Peñiscola\\Informes\\2025\\02 - Febrero 2025\\Informe Residuos Febrero- Mes.docx';

mammoth.extractRawText({ path: docPath })
  .then(result => {
    const text = result.value;
    const excerpt = text.substring(0, 800);
    console.log('=== First 800 characters (cover/title section) ===');
    console.log(excerpt);
    console.log('\n=== Character count:', excerpt.length, '===');
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
