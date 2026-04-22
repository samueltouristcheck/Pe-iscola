const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const pdfPath = path.join(__dirname, 'informes_ejemplo', '02 - Informe Residuos - Febrero 2025.pdf');
const dataBuffer = fs.readFileSync(pdfPath);

pdf(dataBuffer).then(function(data) {
  console.log('=== PDF METADATA ===');
  console.log('Pages:', data.numpages);
  console.log('Info:', JSON.stringify(data.info, null, 2));
  console.log('\n=== EXTRACTED TEXT ===\n');
  console.log(data.text);
}).catch(function(err) {
  console.error('Error:', err);
});
