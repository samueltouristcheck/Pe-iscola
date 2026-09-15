// Función serverless de Vercel: reutiliza la app Express de server.js como handler.
// Vercel enruta cualquier /api/* a este archivo; los ficheros estáticos (index.html,
// js, css, data/*.json, assets) los sirve Vercel directamente desde su CDN.
module.exports = require('../server.js');
