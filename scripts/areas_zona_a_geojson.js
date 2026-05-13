/**
 * Convierte Areas Zona.xlsx (hoja AREA: Area | Longitud | Latitud) en data/zonas_peniscola.geojson
 * para el mapa «Kg por zonas» del dashboard.
 *
 * Uso: node scripts/areas_zona_a_geojson.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const root = path.join(__dirname, '..');
const src = path.join(root, 'Areas Zona.xlsx');
const dst = path.join(root, 'data', 'zonas_peniscola.geojson');

if (!fs.existsSync(src)) {
  console.log('areas_zona_a_geojson: no hay Areas Zona.xlsx en la raíz; no genero GeoJSON.');
  process.exit(0);
}

const wb = XLSX.readFile(src);
const sheet = wb.Sheets['AREA'] || wb.Sheets[wb.SheetNames[0]];
if (!sheet) {
  console.error('areas_zona_a_geojson: no se encontró ninguna hoja.');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const groups = [];
let cur = null;

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const area = String(row[0] || '').trim();
  if (!area) continue;
  const lng = parseFloat(String(row[1]).replace(',', '.'));
  const lat = parseFloat(String(row[2]).replace(',', '.'));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

  if (!cur || cur.name !== area) {
    if (cur) groups.push(cur);
    cur = { name: area, ring: [] };
  }
  cur.ring.push([lng, lat]);
}
if (cur) groups.push(cur);

const features = [];
for (const g of groups) {
  if (g.ring.length < 3) continue;
  const ring = g.ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

  features.push({
    type: 'Feature',
    properties: { name: g.name, nombre: g.name, zona: g.name },
    geometry: {
      type: 'Polygon',
      coordinates: [ring]
    }
  });
}

const fc = { type: 'FeatureCollection', features };
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(fc), 'utf8');
console.log('areas_zona_a_geojson: ' + features.length + ' polígonos → data/zonas_peniscola.geojson');
