/**
 * Conectores de "Redes / Web" para el dashboard.
 *  - Meta Graph API (Facebook Page + Instagram Business) → rendimiento en redes.
 *  - Google Analytics 4 (Data API v1beta) → rendimiento web.
 *
 * Las credenciales se leen de variables de entorno (.env). Si faltan, cada
 * bloque devuelve { configured:false } en vez de fallar, para que el dashboard
 * muestre el estado "conecta tu cuenta" sin romperse.
 *
 * No añade dependencias npm: el token de servicio de Google se firma con `crypto`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/* ---------------------------- utilidades ---------------------------- */

function isoDaysAgo(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    let body;
    try { body = await r.json(); } catch (_) { body = null; }
    if (!r.ok) {
        const msg = (body && body.error && (body.error.message || body.error)) || `HTTP ${r.status}`;
        const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        err.status = r.status;
        err.body = body;
        throw err;
    }
    return body;
}

/* ------------------------------- META ------------------------------- */

function metaConfig() {
    return {
        token: process.env.META_ACCESS_TOKEN || '',
        pageId: process.env.META_PAGE_ID || '',
        igUserId: process.env.META_IG_USER_ID || ''
    };
}

function metaConfigured() {
    const c = metaConfig();
    return Boolean(c.token && (c.pageId || c.igUserId));
}

// Datos de Meta introducidos a mano (cuando no hay acceso a la API por el portfolio).
const META_MANUAL_FILE = path.join(__dirname, 'data', 'REDES', 'meta_manual.json');
function metaManualData() {
    try {
        if (fs.existsSync(META_MANUAL_FILE)) {
            const j = JSON.parse(fs.readFileSync(META_MANUAL_FILE, 'utf8'));
            if (j && (j.facebook || j.instagram)) return j;
        }
    } catch (_) { /* archivo ausente o inválido */ }
    return null;
}

/** Suma los valores de una serie de insights de Graph API (estructura values[].value). */
function sumInsightValues(metricObj) {
    if (!metricObj || !Array.isArray(metricObj.values)) return 0;
    return metricObj.values.reduce((s, v) => s + (typeof v.value === 'number' ? v.value : 0), 0);
}

function dailyFromInsight(metricObj) {
    if (!metricObj || !Array.isArray(metricObj.values)) return [];
    return metricObj.values.map((v) => ({
        date: v.end_time ? String(v.end_time).slice(0, 10) : null,
        value: typeof v.value === 'number' ? v.value : 0
    }));
}

async function getFacebook(token, pageId) {
    if (!pageId) return null;
    const since = isoDaysAgo(30);
    const until = todayIso();
    const out = { id: pageId, name: null, followers: null, fanCount: null, reach: 0, engagement: 0, impressions: 0, daily: [] };

    // Datos básicos de la página
    try {
        const info = await fetchJson(`${GRAPH_BASE}/${pageId}?fields=name,fan_count,followers_count&access_token=${encodeURIComponent(token)}`);
        out.name = info.name || null;
        out.fanCount = info.fan_count != null ? info.fan_count : null;
        out.followers = info.followers_count != null ? info.followers_count : info.fan_count;
    } catch (e) { out.infoError = e.message; }

    // Insights de los últimos 30 días
    try {
        const metrics = 'page_impressions,page_impressions_unique,page_post_engagements';
        const ins = await fetchJson(`${GRAPH_BASE}/${pageId}/insights?metric=${metrics}&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`);
        const byName = {};
        (ins.data || []).forEach((m) => { byName[m.name] = m; });
        out.impressions = sumInsightValues(byName.page_impressions);
        out.reach = sumInsightValues(byName.page_impressions_unique);
        out.engagement = sumInsightValues(byName.page_post_engagements);
        const reachDaily = dailyFromInsight(byName.page_impressions_unique);
        const engDaily = dailyFromInsight(byName.page_post_engagements);
        const map = {};
        reachDaily.forEach((d) => { if (d.date) map[d.date] = { date: d.date, reach: d.value, engagement: 0 }; });
        engDaily.forEach((d) => { if (d.date) { map[d.date] = map[d.date] || { date: d.date, reach: 0, engagement: 0 }; map[d.date].engagement = d.value; } });
        out.daily = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { out.insightsError = e.message; }

    return out;
}

async function getInstagram(token, igUserId) {
    if (!igUserId) return null;
    const since = isoDaysAgo(30);
    const until = todayIso();
    const out = { id: igUserId, username: null, name: null, followers: null, mediaCount: null, reach: 0, daily: [] };

    try {
        const info = await fetchJson(`${GRAPH_BASE}/${igUserId}?fields=username,name,followers_count,media_count&access_token=${encodeURIComponent(token)}`);
        out.username = info.username || null;
        out.name = info.name || null;
        out.followers = info.followers_count != null ? info.followers_count : null;
        out.mediaCount = info.media_count != null ? info.media_count : null;
    } catch (e) { out.infoError = e.message; }

    // Alcance diario (la API de IG ha ido cambiando; lo envolvemos con tolerancia a fallos)
    try {
        const ins = await fetchJson(`${GRAPH_BASE}/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`);
        const reachMetric = (ins.data || []).find((m) => m.name === 'reach');
        out.reach = sumInsightValues(reachMetric);
        out.daily = dailyFromInsight(reachMetric).filter((d) => d.date).map((d) => ({ date: d.date, reach: d.value }));
    } catch (e) { out.insightsError = e.message; }

    return out;
}

async function getMeta() {
    if (!metaConfigured()) {
        const manual = metaManualData();
        if (manual) {
            return {
                configured: true,
                source: 'manual',
                facebook: manual.facebook || null,
                instagram: manual.instagram || null,
                audiencia: manual.audiencia || null,
                historico: manual.historico || []
            };
        }
        return { configured: false };
    }
    const { token, pageId, igUserId } = metaConfig();
    const result = { configured: true, apiVersion: META_API_VERSION };
    try {
        const [fb, ig] = await Promise.all([
            getFacebook(token, pageId).catch((e) => ({ error: e.message })),
            getInstagram(token, igUserId).catch((e) => ({ error: e.message }))
        ]);
        result.facebook = fb;
        result.instagram = ig;
    } catch (e) {
        result.error = e.message;
    }
    return result;
}

/* ------------------------- GOOGLE ANALYTICS 4 ------------------------ */

function gaCredentials() {
    // Opción A: ruta a un JSON de cuenta de servicio
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
    if (credsPath && fs.existsSync(credsPath)) {
        try {
            const j = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (j.client_email && j.private_key) {
                return { clientEmail: j.client_email, privateKey: j.private_key };
            }
        } catch (_) { /* cae al método B */ }
    }
    // Opción B: variables sueltas en .env (private_key con \n escapados)
    const clientEmail = process.env.GA_CLIENT_EMAIL || '';
    let privateKey = process.env.GA_PRIVATE_KEY || '';
    if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
    if (clientEmail && privateKey) return { clientEmail, privateKey };
    return null;
}

/* --- OAuth de usuario (usa TU cuenta de Google, que ya tiene acceso a GA) --- */

const OAUTH_TOKEN_FILE = path.join(__dirname, 'credenciales', 'ga_oauth.json');
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Lee client_id/secret de .env y el refresh_token guardado tras autorizar. */
function gaOAuthConfig() {
    const clientId = process.env.GA_OAUTH_CLIENT_ID || '';
    const clientSecret = process.env.GA_OAUTH_CLIENT_SECRET || '';
    let refreshToken = process.env.GA_OAUTH_REFRESH_TOKEN || '';
    if (!refreshToken && fs.existsSync(OAUTH_TOKEN_FILE)) {
        try { refreshToken = (JSON.parse(fs.readFileSync(OAUTH_TOKEN_FILE, 'utf8')).refresh_token) || ''; } catch (_) { /* nada */ }
    }
    if (clientId && clientSecret && refreshToken) return { clientId, clientSecret, refreshToken };
    return null;
}

/** ¿Hay client_id/secret configurados (aunque aún no se haya autorizado)? */
function gaOAuthClient() {
    const clientId = process.env.GA_OAUTH_CLIENT_ID || '';
    const clientSecret = process.env.GA_OAUTH_CLIENT_SECRET || '';
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** URL de consentimiento de Google para iniciar el flujo OAuth. */
function gaOAuthAuthUrl(redirectUri) {
    const c = gaOAuthClient();
    if (!c) throw new Error('Falta GA_OAUTH_CLIENT_ID / GA_OAUTH_CLIENT_SECRET en .env');
    const params = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GA_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Intercambia el "code" del callback por tokens y guarda el refresh_token. */
async function gaOAuthExchange(code, redirectUri) {
    const c = gaOAuthClient();
    if (!c) throw new Error('Falta GA_OAUTH_CLIENT_ID / GA_OAUTH_CLIENT_SECRET en .env');
    const body = new URLSearchParams({
        code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    });
    const resp = await fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    if (!resp.refresh_token) {
        throw new Error('Google no devolvió refresh_token. Revoca el acceso y reintenta (debe pedir consentimiento).');
    }
    try {
        if (!fs.existsSync(path.dirname(OAUTH_TOKEN_FILE))) fs.mkdirSync(path.dirname(OAUTH_TOKEN_FILE), { recursive: true });
        fs.writeFileSync(OAUTH_TOKEN_FILE, JSON.stringify({ refresh_token: resp.refresh_token, savedAt: new Date().toISOString() }, null, 2));
    } catch (e) { throw new Error('No se pudo guardar el token: ' + e.message); }
    _gaTokenCache = { token: null, exp: 0 };
    return true;
}

function gaConfigured() {
    return Boolean((process.env.GA4_PROPERTY_ID || '') && (gaCredentials() || gaOAuthConfig()));
}

function base64url(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let _gaTokenCache = { token: null, exp: 0 };

async function getGoogleAccessToken() {
    if (_gaTokenCache.token && Date.now() < _gaTokenCache.exp - 60000) return _gaTokenCache.token;

    // Método preferente: OAuth de usuario (tu cuenta, que ya tiene acceso a GA).
    const oauth = gaOAuthConfig();
    if (oauth) {
        const body = new URLSearchParams({
            client_id: oauth.clientId,
            client_secret: oauth.clientSecret,
            refresh_token: oauth.refreshToken,
            grant_type: 'refresh_token'
        });
        const resp = await fetchJson('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        _gaTokenCache = { token: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 };
        return _gaTokenCache.token;
    }

    // Método alternativo: cuenta de servicio (robot) firmando un JWT.
    const creds = gaCredentials();
    if (!creds) throw new Error('Sin credenciales de Google Analytics');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
        iss: creds.clientEmail,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(creds.privateKey).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = `${signingInput}.${signature}`;
    const tokenResp = await fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    _gaTokenCache = { token: tokenResp.access_token, exp: Date.now() + (tokenResp.expires_in || 3600) * 1000 };
    return _gaTokenCache.token;
}

async function gaRunReport(propertyId, accessToken, body) {
    return fetchJson(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body)
    });
}

function gaRows(report) {
    return (report && report.rows) || [];
}

async function getGA() {
    if (!gaConfigured()) return { configured: false };
    const propertyId = String(process.env.GA4_PROPERTY_ID).replace(/^properties\//, '');
    const out = { configured: true, propertyId };
    try {
        const token = await getGoogleAccessToken();
        const dateRange = [{ startDate: '30daysAgo', endDate: 'today' }];

        const [totals, byDay, topPages, sources, countries] = await Promise.all([
            gaRunReport(propertyId, token, {
                dateRanges: dateRange,
                metrics: [
                    { name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' },
                    { name: 'averageSessionDuration' }, { name: 'bounceRate' }
                ]
            }),
            gaRunReport(propertyId, token, {
                dateRanges: dateRange,
                dimensions: [{ name: 'date' }],
                metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
                orderBys: [{ dimension: { dimensionName: 'date' } }]
            }),
            gaRunReport(propertyId, token, {
                dateRanges: dateRange,
                dimensions: [{ name: 'pagePath' }],
                metrics: [{ name: 'screenPageViews' }],
                orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
                limit: 10
            }),
            gaRunReport(propertyId, token, {
                dateRanges: dateRange,
                dimensions: [{ name: 'sessionDefaultChannelGroup' }],
                metrics: [{ name: 'sessions' }],
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: 8
            }),
            gaRunReport(propertyId, token, {
                dateRanges: dateRange,
                dimensions: [{ name: 'country' }],
                metrics: [{ name: 'sessions' }],
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: 8
            })
        ]);

        const t = gaRows(totals)[0];
        const tv = (t && t.metricValues) || [];
        out.sessions = tv[0] ? Number(tv[0].value) : 0;
        out.users = tv[1] ? Number(tv[1].value) : 0;
        out.pageviews = tv[2] ? Number(tv[2].value) : 0;
        out.avgDuration = tv[3] ? Number(tv[3].value) : 0;
        out.bounceRate = tv[4] ? Number(tv[4].value) : 0;

        out.byDay = gaRows(byDay).map((r) => {
            const d = r.dimensionValues[0].value; // YYYYMMDD
            return {
                date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
                sessions: Number(r.metricValues[0].value),
                users: Number(r.metricValues[1].value)
            };
        });
        out.topPages = gaRows(topPages).map((r) => ({ path: r.dimensionValues[0].value, views: Number(r.metricValues[0].value) }));
        out.sources = gaRows(sources).map((r) => ({ source: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) }));
        out.countries = gaRows(countries).map((r) => ({ country: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) }));
    } catch (e) {
        out.error = e.message;
    }
    return out;
}

/* ------------------------------ público ----------------------------- */

async function getRedesOverview() {
    const [meta, ga] = await Promise.all([
        getMeta().catch((e) => ({ configured: metaConfigured(), error: e.message })),
        getGA().catch((e) => ({ configured: gaConfigured(), error: e.message }))
    ]);
    return {
        generatedAt: new Date().toISOString(),
        config: { meta: metaConfigured() || !!metaManualData(), metaManual: !metaConfigured() && !!metaManualData(), ga: gaConfigured() },
        meta,
        ga
    };
}

module.exports = {
    getRedesOverview, metaConfigured, gaConfigured,
    gaOAuthClient, gaOAuthConfig, gaOAuthAuthUrl, gaOAuthExchange
};
