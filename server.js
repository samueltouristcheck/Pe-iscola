/**
 * Servidor para el dashboard de Peñíscola.
 * Sirve los archivos estáticos, /api/chat para el chatbot y /api/generate-report para informes.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const EJEMPLOS_DIR = path.join(__dirname, 'informes_ejemplo');
const PORT = process.env.PORT || 7777;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});
app.use(express.json());

// Ruta raíz: devolver index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API ligera para dashboard (evita cargar 2.5MB)
app.get('/api/camaras/dashboard', (req, res) => {
    const p = path.join(__dirname, 'data', 'camaras', 'todos.json');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Archivo no encontrado' });
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        const lpr = data.lpr || {};
        res.json({
            lpr: {
                entradasSalidasPorMes: lpr.entradasSalidasPorMes || {},
                entradasSalidasPorDia: lpr.entradasSalidasPorDia || {},
                entradasSalidasPorHora: lpr.entradasSalidasPorHora || {},
                byCamara: lpr.byCamara || {},
                byNacionalidad: lpr.byNacionalidad || {},
                byColor: lpr.byColor || {},
                agregados: lpr.agregados || []
            },
            camarasMapa: data.camarasMapa || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Rutas explícitas para datos (asegura que se sirvan correctamente)
app.get('/data/camaras/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'camaras', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/resumen.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'resumen.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/pesajes/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'pesajes', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/camion/todos.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'todos.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/camion/mapa.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'mapa.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/RESIDUOS/camion/mapa_sample.json', (req, res) => {
    const p = path.join(__dirname, 'data', 'RESIDUOS', 'camion', 'mapa_sample.json');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).json({ error: 'Archivo no encontrado' });
});
app.get('/data/zonas_peniscola.geojson', (req, res) => {
    const p = path.join(__dirname, 'data', 'zonas_peniscola.geojson');
    if (fs.existsSync(p)) {
        res.type('application/geo+json');
        res.sendFile(p);
    } else res.status(404).json({ error: 'Archivo no encontrado' });
});

// Archivos estáticos (css, js, data, etc.)
app.use(express.static(path.join(__dirname)));

// Verificación: si ves {"ok":true} al abrir /api/status, estás usando el servidor Node correcto
app.get('/api/status', (req, res) => res.json({ ok: true, server: 'Node.js', htmlReport: true }));

app.post('/api/chat', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY no configurada en .env' });
    }
    const { message, history, context } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Falta el mensaje' });
    }
    const systemPrompt = `Eres un asistente del dashboard de residuos de Peñíscola (España). Responde en español de forma breve y útil. Usa estos datos del dashboard para responder:\n\n${context || 'Sin contexto'}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        ...(history || []).slice(-10).map(m => ({ role: m.isBot ? 'assistant' : 'user', content: m.text })),
        { role: 'user', content: message }
    ];
    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });
        const data = await r.json();
        if (!r.ok) {
            throw new Error(data.error?.message || r.statusText || 'Error API');
        }
        const text = data.choices?.[0]?.message?.content?.trim() || 'No hubo respuesta.';
        res.json({ reply: text });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al conectar con OpenAI' });
    }
});

const PLANTILLA_PATH = path.join(EJEMPLOS_DIR, 'plantilla_informe.txt');

function generarInformeDesdePlantilla(data) {
    const plantilla = fs.existsSync(PLANTILLA_PATH) ? fs.readFileSync(PLANTILLA_PATH, 'utf8') : null;
    if (!plantilla) return null;
    const fmt = (n) => (n ?? 0).toLocaleString('es-ES');
    const fmtPct = (n) => (n != null ? n.toFixed(2).replace('.', ',') + '%' : '--');
    const periodoLabel = data.periodoLabel || data.periodo || '--';
    const comp = data.comparacionPeriodoAnterior || {};
    const diffCamion = comp.diffCamion != null ? fmtPct(comp.diffCamion) : '--';
    const diffSalidas = comp.diffSalidas != null ? fmtPct(comp.diffSalidas) : '--';
    const totalKg = (data.kgCamion || 0) + (data.kgExcel || 0);
    const pctHoteles = data.pctResiduosHoteles != null ? fmtPct(parseFloat(data.pctResiduosHoteles)) : '--';

    const zonas = (data.zonas || []).map(([z, k]) => `- ${z}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const contenedores = (data.contenedores || []).map(([c, k]) => `- ${c}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const hoteles = (data.hoteles || []).map(([h, k]) => `- ${h}: ${fmt(k)} kg`).join('\n') || '- Sin datos';
    const tipos = (data.tipos || []).map(([t, k]) => `- ${t}: ${fmt(k)} kg`).join('\n') || '- Sin datos';

    const topHoteles = (data.hoteles || []).slice(0, 4).map(([h]) => h).join(', ');
    const conclusiones = `Se han recogido un total de ${fmt(data.kgCamion)} kg de residuos (camión RFID) en ${periodoLabel}, con ${data.salidas || 0} salidas registradas.${comp.periodo ? ` Variación respecto a ${comp.periodo}: ${diffCamion} en kg, ${diffSalidas} en salidas.` : ''}${topHoteles ? ` Principales generadores: ${topHoteles}.` : ''}`;

    return plantilla
        .replace(/\{\{MES_AÑO\}\}/g, periodoLabel.toUpperCase())
        .replace(/\{\{TOTAL_KG\}\}/g, fmt(totalKg))
        .replace(/\{\{SALIDAS\}\}/g, fmt(data.salidas))
        .replace(/\{\{PERIODO_ANTERIOR\}\}/g, comp.periodo || '--')
        .replace(/\{\{DIF_CAMION\}\}/g, diffCamion)
        .replace(/\{\{DIF_SALIDAS\}\}/g, diffSalidas)
        .replace(/\{\{PCT_HOTELES\}\}/g, pctHoteles)
        .replace(/\{\{ZONAS\}\}/g, zonas)
        .replace(/\{\{CONTENEDORES\}\}/g, contenedores)
        .replace(/\{\{HOTELES\}\}/g, hoteles)
        .replace(/\{\{TIPOS\}\}/g, tipos)
        .replace(/\{\{CONCLUSIONES\}\}/g, conclusiones);
}

async function analizarConChatGPT(apiKey, data) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: 'Eres un analista de residuos para el Ayuntamiento de Peñíscola. Analiza los datos y escribe un informe en español: compara con mes anterior y año anterior, destaca tendencias, principales generadores, zonas con más residuos. Usa ÚNICAMENTE los datos proporcionados. Formato: párrafos claros, números con formato español (455.380 kg, -49,01%). Máximo 600 palabras.'
            }, {
                role: 'user',
                content: `Analiza estos datos de residuos y escribe un informe comparativo:\n${JSON.stringify(data, null, 2)}`
            }],
            max_tokens: 1500,
            temperature: 0.5
        })
    });
    const resp = await r.json();
    if (!r.ok) throw new Error(resp.error?.message || r.statusText);
    return resp.choices?.[0]?.message?.content?.trim() || '';
}

function generarHTMLInforme(data, analisisChatGPT) {
    const fmt = (n) => (n ?? 0).toLocaleString('es-ES');
    const zonas = data.zonas || [];
    const tipos = (data.tipos || []).slice(0, 10);
    const hoteles = (data.hoteles || []).slice(0, 10);
    const comp = data.comparacionPeriodoAnterior || {};
    const compMes = data.comparacionMesAnterior || {};
    const itemsComp = [
        [data.periodoLabel, data.kgCamion, data.salidas],
        [compMes.periodo, compMes.kgCamion, compMes.salidas],
        [comp.periodo, comp.kgCamion, comp.salidas]
    ].filter(([l, k]) => l && k != null);
    const labelsComp = itemsComp.map(([l]) => l);
    const kgComp = itemsComp.map(([, k]) => k);
    const salidasComp = itemsComp.map(([, , s]) => s);
    const zonasData = JSON.stringify(zonas.slice(0, 10).map(([z, k]) => ({ z, k })));
    const tiposData = JSON.stringify(tipos.map(([t, k]) => ({ t, k })));
    const hotelesData = JSON.stringify(hoteles.map(([h, k]) => ({ h: h.length > 25 ? h.slice(0, 22) + '...' : h, k })));
    const compData = JSON.stringify({ labels: labelsComp, kg: kgComp, salidas: salidasComp });
    const analisis = (analisisChatGPT || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe Residuos ${data.periodoLabel || ''}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:2rem;background:#1a2332;color:#e6edf3;line-height:1.6;}
h1,h2{color:#00c9a7;}h2{margin-top:2rem;}
.chart-box{background:#0f1419;border-radius:8px;padding:1rem;margin:1rem 0;height:280px;}
.analisis{background:#0f1419;padding:1.5rem;border-radius:8px;margin:1rem 0;border-left:4px solid #00c9a7;}
table{width:100%;border-collapse:collapse;margin:1rem 0;}
th,td{padding:0.5rem;text-align:left;border-bottom:1px solid #30363d;}
th{color:#8b949e;}
</style>
</head>
<body>
<h1>INFORME RESIDUOS ${(data.periodoLabel || '').toUpperCase()}</h1>

<div class="analisis">
<h2>Análisis comparativo (ChatGPT)</h2>
<div>${analisis || 'Sin análisis disponible.'}</div>
</div>

<h2>Comparación: Kg y salidas</h2>
<div class="chart-box"><canvas id="chartComp"></canvas></div>

<h2>Residuos por zona (top 10)</h2>
<div class="chart-box"><canvas id="chartZonas"></canvas></div>

<h2>Tipos de residuo</h2>
<div class="chart-box"><canvas id="chartTipos"></canvas></div>

<h2>Hoteles y campings (top 10)</h2>
<div class="chart-box"><canvas id="chartHoteles"></canvas></div>

<h2>Datos por zona</h2>
<table><thead><tr><th>Zona</th><th>Kg</th></tr></thead><tbody>
${zonas.map(([z, k]) => `<tr><td>${z}</td><td>${fmt(k)}</td></tr>`).join('')}
</tbody></table>

<h2>Datos por tipo de contenedor</h2>
<table><thead><tr><th>Contenedor</th><th>Kg</th></tr></thead><tbody>
${(data.contenedores || []).map(([c, k]) => `<tr><td>${c}</td><td>${fmt(k)}</td></tr>`).join('')}
</tbody></table>

<script>
const opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8b949e'}}},scales:{x:{ticks:{color:'#8b949e'},grid:{color:'#30363d'}},y:{ticks:{color:'#8b949e'},grid:{color:'#30363d'}}}};
const comp=${compData};
if(comp.labels.length&&comp.kg.length){
new Chart(document.getElementById('chartComp'),{type:'bar',data:{labels:comp.labels,datasets:[{label:'Kg',data:comp.kg,backgroundColor:'#00c9a7'},{label:'Salidas',data:comp.salidas,backgroundColor:'#7c3aed',yAxisID:'y1'}]},options:{...opts,scales:{...opts.scales,y:{...opts.scales.y},y1:{type:'linear',position:'right',ticks:{color:'#8b949e'},grid:{display:false}}}}});
}
const zonas=${zonasData};
if(zonas.length){new Chart(document.getElementById('chartZonas'),{type:'bar',data:{labels:zonas.map(x=>x.z),datasets:[{label:'Kg',data:zonas.map(x=>x.k),backgroundColor:'#00c9a7'}]},options:opts});}
const tipos=${tiposData};
if(tipos.length){new Chart(document.getElementById('chartTipos'),{type:'doughnut',data:{labels:tipos.map(x=>x.t),datasets:[{data:tipos.map(x=>x.k),backgroundColor:['#00c9a7','#7c3aed','#f59e0b','#ef4444','#3b82f6','#ec4899','#10b981','#6366f1','#14b8a6','#a855f7']}]},options:{...opts,scales:{}}});}
const hoteles=${hotelesData};
if(hoteles.length){new Chart(document.getElementById('chartHoteles'),{type:'bar',data:{labels:hoteles.map(x=>x.h),datasets:[{label:'Kg',data:hoteles.map(x=>x.k),backgroundColor:'#7c3aed'}]},options:{...opts}});}
</script>
</body>
</html>`;
}

const { generarDocx, getRutaPortada } = require('./generadorWord');

// Procesar archivos CSV/Excel de cámaras (lee data/camaras/entrada/, escribe todos.json)
app.post('/api/process-camaras', (req, res) => {
    try {
        const { execSync } = require('child_process');
        execSync('node procesar_camaras.js', { cwd: __dirname, stdio: 'pipe' });
        res.json({ ok: true, message: 'Archivos procesados' });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Error al procesar' });
    }
});

app.post('/api/export-word', async (req, res) => {
    const { data, reportTxt } = req.body || {};
    if (!data || !reportTxt) {
        return res.status(400).json({ error: 'Faltan datos o texto del informe' });
    }
    try {
        const buf = await generarDocx(data, reportTxt);
        const nombre = `Informe_Residuos_${(data.periodoLabel || 'informe').replace(/\s+/g, '_')}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
        res.send(Buffer.from(buf));
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al generar Word' });
    }
});

app.post('/api/generate-report', async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    const { periodo, periodoLabel, data } = req.body || {};
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Faltan los datos del informe' });
    }
    try {
        let analisis = '';
        if (apiKey) {
            try {
                analisis = await analizarConChatGPT(apiKey, data);
            } catch (e) {
                console.warn('ChatGPT análisis:', e.message);
            }
        }
        const html = generarHTMLInforme(data, analisis);
        const report = generarInformeDesdePlantilla(data);
        res.json({ report, html, analisis });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Error al generar el informe' });
    }
});

// Al arrancar: procesar cámaras en segundo plano para que los datos estén ya listos
function asegurarDatosCamaras() {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['procesar_camaras.js'], { cwd: __dirname, stdio: 'ignore' });
    proc.on('close', (code) => {
        if (code === 0) console.log('Cámaras: datos procesados.');
        else console.warn('Cámaras: procesamiento finalizado con código', code);
    });
    proc.on('error', (e) => console.warn('Cámaras:', e.message));
}

app.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    asegurarDatosCamaras();
});
