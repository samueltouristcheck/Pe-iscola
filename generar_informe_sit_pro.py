# -*- coding: utf-8 -*-
"""
FASE 2 del rebuild: informe SIT de cámaras PROFESIONAL (determinista, sin relleno IA).
Lee data/camaras/sit_fichas.json y produce data/informes_sit/sit_pro_<mes>.html:
ficha por cámara (diario + 8 franjas + punta declarada + procedencia + laborable/finde),
análisis transversal (heatmap hora×día), metodología, RGPD y anexos.
Paleta única (azul entrada / ámbar salida / gris). Sin emojis.

Uso: python generar_informe_sit_pro.py 2026-06
"""
import sys, os, json, datetime, re, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
PROD = os.environ.get('SIT_API', 'https://pe-iscola.onrender.com')
AZUL, AMBAR, GRIS = '#1d4ed8', '#b45309', '#64748b'
DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

# Configuración de los 9 puntos de control según la especificación del Ayuntamiento
# (nombre exacto + etiquetas de sentido propias de cada cámara).
PUNTOS = {
    'estibaliz': {'n': 1, 'nombre': 'Rotonda Estíbaliz', 'ent': 'Entrada al municipio', 'sal': 'Salida del municipio'},
    'irta':      {'n': 2, 'nombre': 'Cámara Calle Irta', 'ent': 'Sentido Pueblo', 'sal': 'Sentido Parque'},
    'abellers':  {'n': 3, 'nombre': 'Rotonda Abellers', 'ent': 'Entrada', 'sal': 'Salida'},
    'fosc':      {'n': 6, 'nombre': 'Cámara Portal Fosc (Rampa Felipe II – Plaza de Bous – acceso a Santa María)', 'ent': 'Peatones entrada', 'sal': 'Peatones salida'},
    'mar':       {'n': 7, 'nombre': 'Cámara Avenida de la Mar', 'ent': 'Peatones entrada', 'sal': 'Peatones salida'},
    'ayto':      {'n': 8, 'nombre': 'Cámara Ayuntamiento', 'ent': 'Peatones subida', 'sal': 'Peatones bajada'},
    'santpere':  {'n': 9, 'nombre': 'Cámara Portal de Sant Pere', 'ent': 'Peatones entrada', 'sal': 'Peatones salida'},
}

def fmt(n):
    try: return format(int(round(n)), ',').replace(',', '.')
    except Exception: return str(n)

def esc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# --- SVG helpers ---
def sparkline(dias, key1, key2, w=560, h=90):
    if not dias: return ''
    xs = [d['d'] for d in dias]
    v1 = [d[key1] for d in dias]; v2 = [d.get(key2, 0) for d in dias]
    mx = max(max(v1), max(v2), 1); n = len(dias)
    def pts(v): return ' '.join('%.1f,%.1f' % (12 + i*(w-24)/(n-1 or 1), h-14-(val/mx)*(h-28)) for i, val in enumerate(v))
    grid = ''.join('<line x1="12" y1="%.1f" x2="%d" y2="%.1f" stroke="#eef2f7"/>' % (h-14-f*(h-28), w-12, h-14-f*(h-28)) for f in (0.5, 1))
    labs = ''.join('<text x="%.1f" y="%d" font-size="8" fill="#94a3b8" text-anchor="middle">%d</text>' % (12+i*(w-24)/(n-1 or 1), h-3, xs[i]) for i in range(0, n, max(1, n//10)))
    return ('<svg viewBox="0 0 %d %d" width="100%%" style="max-width:%dpx">%s'
            '<polyline points="%s" fill="none" stroke="%s" stroke-width="1.8"/>'
            '<polyline points="%s" fill="none" stroke="%s" stroke-width="1.8"/>%s</svg>'
            % (w, h, w, grid, pts(v1), AZUL, pts(v2), AMBAR, labs))

def barras_franjas(franjas, w=560, h=150):
    mx = max((f['ent'] + f['sal']) for f in franjas) or 1
    n = len(franjas); bw = (w - 40) / n
    bars = ''
    for i, f in enumerate(franjas):
        x = 30 + i*bw
        he = (f['ent']/mx)*(h-40); hs = (f['sal']/mx)*(h-40)
        bars += ('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>'
                 '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>'
                 '<text x="%.1f" y="%d" font-size="7.5" fill="#64748b" text-anchor="end" transform="rotate(-90 %.1f %d)">%s</text>'
                 % (x+2, h-20-he, bw/2-3, he, AZUL, x+bw/2, h-20-hs, bw/2-3, hs, AMBAR,
                    x+bw/2, h-24, x+bw/2, h-24, f['etq'].split('–')[0]))
    return '<svg viewBox="0 0 %d %d" width="100%%" style="max-width:%dpx">%s</svg>' % (w, h, w, bars)

def barra_proc(p):
    ext = p['pctExt']; nac = round(100 - ext, 1)
    return ('<div class="proc"><div class="proc-bar"><span style="width:%s%%;background:%s"></span>'
            '<span style="width:%s%%;background:%s"></span></div>'
            '<div class="proc-leg"><span><i style="background:%s"></i>Nacional %s (%s%%)</span>'
            '<span><i style="background:%s"></i>Extranjera %s (%s%%)</span></div></div>'
            % (nac, AZUL, ext, GRIS, AZUL, fmt(p['nac']), str(nac).replace('.', ','), GRIS, fmt(p['ext']), str(ext).replace('.', ',')))

def heatmap(heat, w=560):
    mx = max((max(row) for row in heat), default=1) or 1
    cw = (w - 30) / 24; ch = 16
    cells = ''
    for wd in range(7):
        for h in range(24):
            v = heat[wd][h]; t = v/mx
            col = '#eef2f7' if t == 0 else 'rgb(%d,%d,%d)' % (int(219-t*(219-29)), int(234-t*(234-78)), int(254-t*(254-216)))
            cells += '<rect x="%.1f" y="%d" width="%.1f" height="%d" fill="%s"/>' % (30+h*cw, 6+wd*ch, cw-1, ch-1, col)
        cells += '<text x="24" y="%d" font-size="9" fill="#64748b" text-anchor="end">%s</text>' % (6+wd*ch+11, DIAS[wd])
    horas = ''.join('<text x="%.1f" y="%d" font-size="8" fill="#94a3b8" text-anchor="middle">%02d</text>' % (30+h*cw+cw/2, 6+7*ch+9, h) for h in range(0, 24, 3))
    return '<svg viewBox="0 0 %d %d" width="100%%" style="max-width:%dpx">%s%s</svg>' % (w, 6+7*ch+14, w, cells, horas)

def kpi(v, lbl, sub=''):
    return '<div class="kpi"><div class="kpi-v">%s</div><div class="kpi-l">%s</div>%s</div>' % (v, lbl, ('<div class="kpi-s">%s</div>' % sub) if sub else '')

# --- fichas ---
def ficha_lpr(cfg, c):
    n, nombre, le, ls = cfg['n'], cfg['nombre'], cfg['ent'], cfg['sal']
    return ('<div class="ficha"><div class="ficha-h"><span class="pnum">%d</span><h3>%s '
            '<span class="tag">Tráfico · LPR (matrículas)</span></h3></div>'
            '<div class="kpis mini">%s%s%s%s</div>'
            '<div class="sub">Vehículos por día (%s en azul · %s en ámbar)</div>%s'
            '<div class="sub">Distribución por franjas horarias</div>%s'
            '<div class="punta">Franja horaria de mayor intensidad — <b>%s</b>: %s (%s veh.) · <b>%s</b>: %s (%s veh.)</div>'
            '<div class="sub">Procedencia de la matrícula (nacional / extranjera)</div>%s'
            '<div class="lf">Laborable: <b>%s</b> / <b>%s</b> · Fin de semana: <b>%s</b> / <b>%s</b> (%s / %s)</div></div>'
            % (n, esc(nombre),
               kpi(fmt(c['totalEnt']), le), kpi(fmt(c['totalSal']), ls),
               kpi(('+' if c['balance'] >= 0 else '') + fmt(c['balance']), 'Balance del periodo'),
               kpi(str(c['proc']['pctExt']).replace('.', ',') + '%', 'Matrícula extranjera'),
               esc(le), esc(ls), sparkline(c['diario'], 'ent', 'sal'), barras_franjas(c['franjas']),
               esc(le), c['picoEnt']['franja'], fmt(c['picoEnt']['val']), esc(ls), c['picoSal']['franja'], fmt(c['picoSal']['val']),
               barra_proc(c['proc']),
               fmt(c['lab']['ent']), fmt(c['lab']['sal']), fmt(c['fin']['ent']), fmt(c['fin']['sal']), esc(le), esc(ls)))

def ficha_aforo(cfg, c):
    n, nombre, le, ls = cfg['n'], cfg['nombre'], cfg['ent'], cfg['sal']
    return ('<div class="ficha"><div class="ficha-h"><span class="pnum">%d</span><h3>%s '
            '<span class="tag aforo">Aforo · peatones y vehículos</span></h3></div>'
            '<div class="kpis mini">%s%s%s%s</div>'
            '<div class="sub">Peatones por día (%s en azul · %s en ámbar)</div>%s'
            '<div class="sub">Peatones desglosados por franjas horarias</div>%s'
            '<div class="punta">Franja horaria de mayor concentración — <b>%s</b>: %s (%s) · <b>%s</b>: %s (%s)</div>'
            '<div class="lf">Laborable: <b>%s</b> / <b>%s</b> · Fin de semana: <b>%s</b> / <b>%s</b> (%s / %s)</div></div>'
            % (n, esc(nombre),
               kpi(fmt(c['totalEnt']), le), kpi(fmt(c['totalSal']), ls),
               kpi(fmt(c['vehEnt']), 'Vehículos entrada'), kpi(fmt(c['vehSal']), 'Vehículos salida'),
               esc(le), esc(ls), sparkline(c['diario'], 'ent', 'sal'), barras_franjas(c['franjas']),
               esc(le), c['picoEnt']['franja'], fmt(c['picoEnt']['val']), esc(ls), c['picoSal']['franja'], fmt(c['picoSal']['val']),
               fmt(c['lab']['ent']), fmt(c['lab']['sal']), fmt(c['fin']['ent']), fmt(c['fin']['sal']), esc(le), esc(ls)))

def ficha_pend(n, titulo, requeridos):
    lis = ''.join('<li>' + esc(r) + '</li>' for r in requeridos)
    return ('<div class="ficha pend"><div class="ficha-h"><span class="pnum">%d</span><h3>%s</h3></div>'
            '<p class="pend-t">Punto pendiente: la cámara aún no está dada de alta/configurada en el sistema. '
            'Cuando esté operativa, este apartado incorporará la información requerida por la especificación:</p>'
            '<ul class="pend-req">%s</ul></div>' % (n, esc(titulo), lis))

# --- análisis redactado por IA (producción) ---
def resumen_datos(lpr, af):
    cams = []
    for k, c in lpr.items():
        if c:
            p = PUNTOS.get(k, {})
            cams.append({'clave': k, 'nombre': p.get('nombre', c['nombre']), 'tipo': 'LPR',
                         'sentidoA': p.get('ent', 'entrada'), 'sentidoB': p.get('sal', 'salida'),
                         'vehiculosSentidoA': c['totalEnt'], 'vehiculosSentidoB': c['totalSal'],
                         'balance': c['balance'], 'picoSentidoA': c['picoEnt'], 'picoSentidoB': c['picoSal'],
                         'pctExtranjera': c['proc']['pctExt'], 'laborable': c['lab'], 'finde': c['fin']})
    for k, c in af.items():
        if c:
            p = PUNTOS.get(k, {})
            cams.append({'clave': k, 'nombre': p.get('nombre', c['nombre']), 'tipo': 'aforo',
                         'sentidoA': p.get('ent', 'peatones entrada'), 'sentidoB': p.get('sal', 'peatones salida'),
                         'peatonesSentidoA': c['totalEnt'], 'peatonesSentidoB': c['totalSal'],
                         'vehiculosEntrada': c['vehEnt'], 'vehiculosSalida': c['vehSal'], 'picoPeatonA': c['picoEnt'],
                         'picoPeatonB': c['picoSal'], 'laborable': c['lab'], 'finde': c['fin']})
    return cams

def parse_secciones(txt):
    out = {'resumen': '', 'transversal': '', 'conclusiones': '', 'cam': {}}
    parts = re.split(r'\[\[(RESUMEN|TRANSVERSAL|CONCLUSIONES|CAM:[a-zA-Z]+)\]\]', txt)
    for i in range(1, len(parts), 2):
        m = parts[i]; cont = parts[i + 1].strip() if i + 1 < len(parts) else ''
        if m == 'RESUMEN': out['resumen'] = cont
        elif m == 'TRANSVERSAL': out['transversal'] = cont
        elif m == 'CONCLUSIONES': out['conclusiones'] = cont
        elif m.startswith('CAM:'): out['cam'][m[4:]] = cont
    return out

def pedir_analisis(lpr, af, periodoLabel):
    payload = {'periodoLabel': periodoLabel, 'resumenDatos': resumen_datos(lpr, af)}
    try:
        req = urllib.request.Request(PROD + '/api/sit-analisis', data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.load(r)
        if res.get('error'):
            print('  aviso: IA error:', res['error']); return None
        return parse_secciones(res.get('texto', ''))
    except Exception as e:
        print('  aviso: análisis IA no disponible (%s)' % str(e)[:90]); return None

def prosa(txt):
    if not txt: return ''
    ps = [p.strip() for p in re.split(r'\n{1,}', txt) if p.strip()]
    return '<div class="prosa">' + ''.join('<p>' + esc(p) + '</p>' for p in ps) + '</div>'

def conclusiones_html(txt):
    if not txt: return ''
    lines = [l.strip(' -•\t·') for l in txt.split('\n') if l.strip(' -•\t·')]
    return '<ul class="concl">' + ''.join('<li>' + esc(l) + '</li>' for l in lines) + '</ul>'

def generar(mes):
    doc = json.load(open(os.path.join(BASE, 'data', 'camaras', 'sit_fichas.json'), encoding='utf-8'))
    d = doc['datos'][mes]; lpr = d['lpr']; af = d['aforo']
    an = pedir_analisis(lpr, af, d['periodoLabel']) or {'resumen': '', 'transversal': '', 'conclusiones': '', 'cam': {}}
    # heatmap agregado (suma de todas las cámaras con dato)
    heat = [[0]*24 for _ in range(7)]
    for src in (lpr, af):
        for c in src.values():
            if c:
                for wd in range(7):
                    for h in range(24):
                        heat[wd][h] += c['heat'][wd][h]
    # exec KPIs
    veh_ent = sum(c['totalEnt'] for c in lpr.values() if c)
    veh_sal = sum(c['totalSal'] for c in lpr.values() if c)
    peat = sum(c['totalEnt'] + c['totalSal'] for c in af.values() if c)
    n_ok = sum(1 for c in list(lpr.values()) + list(af.values()) if c)
    tot_nac = sum(c['proc']['nac'] for c in lpr.values() if c)
    tot_ext = sum(c['proc']['ext'] for c in lpr.values() if c)
    pct_ext = round(100*tot_ext/(tot_nac+tot_ext), 1) if (tot_nac+tot_ext) else 0

    orden = [('lpr', 'estibaliz'), ('lpr', 'irta'), ('lpr', 'abellers'),
             ('pend4', None), ('pend5', None),
             ('af', 'fosc'), ('af', 'mar'), ('af', 'ayto'), ('af', 'santpere')]
    PEND = {
        4: ('Parking Disuasorio — Cámaras de vehículos (turismos)',
            ['Número diario de vehículos que acceden al parking.',
             'Número diario de vehículos que abandonan el parking.',
             'Identificación individual de entradas y salidas de cada vehículo (hora de acceso y de salida).',
             'Franja horaria con mayor número de entradas.',
             'Franja horaria con mayor número de salidas.']),
        5: ('Parking Disuasorio — Cámaras de autobuses',
            ['Número diario de autobuses que acceden al parking.',
             'Número diario de autobuses que abandonan el parking.',
             'Tiempo de permanencia de cada autobús dentro del recinto (filtrado por tipo «autobús»).']),
    }
    def con_nota(html, key):
        nota = an['cam'].get(key, '')
        if not nota: return html
        idx = html.rfind('</div>')
        return html[:idx] + '<div class="cam-nota">' + esc(nota) + '</div>' + html[idx:]
    def ficha_sindatos(cfg):
        return ('<div class="ficha pend"><div class="ficha-h"><span class="pnum">%d</span><h3>%s</h3></div>'
                '<p class="pend-t">Sin datos disponibles para este periodo. Las lecturas de matrícula (LPR) '
                'solo están disponibles hasta junio de 2026.</p></div>' % (cfg['n'], esc(cfg['nombre'])))
    fichas = ''
    for tipo, key in orden:
        if tipo == 'pend4':
            fichas += ficha_pend(4, PEND[4][0], PEND[4][1])
        elif tipo == 'pend5':
            fichas += ficha_pend(5, PEND[5][0], PEND[5][1])
        elif tipo == 'lpr':
            fichas += con_nota(ficha_lpr(PUNTOS[key], lpr[key]), key) if lpr.get(key) else ficha_sindatos(PUNTOS[key])
        elif tipo == 'af':
            fichas += con_nota(ficha_aforo(PUNTOS[key], af[key]), key) if af.get(key) else ficha_sindatos(PUNTOS[key])

    css = """
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;max-width:840px;margin:0 auto;padding:26px;line-height:1.5}
    h1{font-size:19px;text-align:center;color:#0f172a;margin:0}
    h2{font-size:15px;color:#0f172a;border-bottom:2px solid #1d4ed8;padding-bottom:5px;margin:26px 0 12px}
    h3{font-size:14px;margin:0;color:#0f172a}
    .meta{text-align:center;color:#64748b;font-size:12px;margin:2px 0 20px}
    .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
    .kpis.mini{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px}
    .kpi-v{font-size:1.25rem;font-weight:800;color:#1d4ed8}.mini .kpi-v{font-size:1.05rem}
    .kpi-l{font-size:.76rem;color:#334155;font-weight:600}.kpi-s{font-size:.68rem;color:#94a3b8}
    .ficha{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px;page-break-inside:avoid}
    .ficha-h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
    .pnum{width:24px;height:24px;border-radius:50%;background:#1d4ed8;color:#fff;font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    .tag{font-size:.66rem;font-weight:600;background:#eff6ff;color:#1d4ed8;padding:.1rem .45rem;border-radius:999px}
    .tag.aforo{background:#fff7ed;color:#b45309}
    .sub{font-size:.8rem;font-weight:600;color:#475569;margin:10px 0 3px}
    .punta{font-size:.82rem;background:#f8fafc;border-left:3px solid #1d4ed8;padding:6px 10px;margin:8px 0;border-radius:0 6px 6px 0}
    .lf{font-size:.8rem;color:#475569;margin-top:8px}
    .proc-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#eef2f7}
    .proc-bar span{display:block;height:100%}
    .proc-leg{display:flex;gap:16px;flex-wrap:wrap;margin-top:5px;font-size:.78rem;color:#475569}
    .proc-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:middle}
    .ficha.pend{background:#fffbeb;border-color:#fde68a}.pend .pnum{background:#d97706}
    .pend-t{color:#92400e;font-size:.85rem;margin:0}
    .pend-req{margin:8px 0 0 0;padding:0 0 0 18px;color:#92400e;font-size:.82rem}
    .pend-req li{margin:3px 0}
    .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:.85rem}
    .box ul{margin:6px 0 0 16px;padding:0}.box li{margin:3px 0}
    .warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:10px 12px;font-size:.82rem;margin:10px 0}
    table.def{width:100%;border-collapse:collapse;font-size:.8rem;margin-top:6px}
    table.def td{border:1px solid #e2e8f0;padding:5px 8px}table.def td:first-child{font-weight:600;width:38%;background:#f8fafc}
    .foot{margin-top:22px;border-top:1px solid #e2e8f0;padding-top:10px;color:#64748b;font-size:.75rem}
    .prosa{font-size:.9rem;color:#334155;margin:12px 0}
    .prosa p{margin:0 0 9px}
    .cam-nota{font-size:.85rem;color:#334155;background:#f8fafc;border-left:3px solid #64748b;padding:8px 12px;margin-top:10px;border-radius:0 6px 6px 0}
    .concl{margin:10px 0 0 0;padding:0;list-style:none}
    .concl li{position:relative;padding:8px 12px 8px 30px;margin-bottom:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:.86rem;color:#334155}
    .concl li:before{content:"";position:absolute;left:12px;top:13px;width:8px;height:8px;border-radius:50%;background:#1d4ed8}
    """
    hoy = doc.get('_hoy', '')
    html = ('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe SIT Cámaras · %s</title><style>%s</style></head><body>'
            '<h1>INFORME DE CÁMARAS DE CONTROL DE TRÁFICO Y AFORO</h1>'
            '<div class="meta">Sistema de Inteligencia Turística (SIT) · Ayuntamiento de Peñíscola · <b>%s</b> · v1</div>'
            % (esc(d['periodoLabel']), css, esc(d['periodoLabel'])))

    # Objeto del informe (según especificación del Ayuntamiento)
    html += ('<div class="box" style="margin-bottom:6px"><b>Objeto.</b> Este informe incorpora al Sistema de Inteligencia Turística (SIT) '
             'de Peñíscola la información obtenida de las cámaras de control de tráfico y aforo del municipio, con el fin de analizar la '
             'movilidad, los flujos de visitantes y el comportamiento de los usuarios del destino. Se estructura en los <b>9 puntos de control</b> '
             'definidos por el Ayuntamiento, detallando para cada uno los datos requeridos (volúmenes por sentido, balance, franjas horarias de '
             'mayor intensidad, procedencia de la matrícula y flujos peatonales).</div>')

    # Resumen ejecutivo
    html += ('<h2>1. Resumen ejecutivo</h2><div class="kpis">'
             + kpi(fmt(veh_ent), 'Vehículos de entrada', 'suma de cámaras LPR')
             + kpi(fmt(veh_sal), 'Vehículos de salida', 'suma de cámaras LPR')
             + kpi(fmt(peat), 'Pasos de peatones', 'aforo, sin deduplicar')
             + kpi('%d / 9' % n_ok, 'Puntos con datos', '%d pendientes' % (9-n_ok))
             + kpi(str(pct_ext).replace('.', ',') + '%', 'Matrícula extranjera', 'sobre identificadas')
             + '</div>')
    html += ('<div class="warn"><b>Cómo leer estas cifras.</b> Los «pasos» de aforo son cruces de la línea de conteo, '
             '<b>no visitantes únicos</b> (una persona puede cruzar varias veces). El balance entrada−salida por cámara '
             'no mide población: refleja la cobertura de cada punto y su sentido predominante, por lo que un saldo negativo '
             'en una cámara es esperable y <b>no significa pérdida de vehículos en el municipio</b>.</div>')
    html += prosa(an['resumen'])

    # Metodología
    filas_cam = ''
    for k, c in list(lpr.items()):
        filas_cam += '<tr><td>%s</td><td>LPR (matrículas)</td></tr>' % esc(PUNTOS.get(k, {}).get('nombre', c['nombre'])) if c else ''
    for k, c in list(af.items()):
        filas_cam += '<tr><td>%s</td><td>Aforo multiobjeto (personas + vehículos)</td></tr>' % esc(PUNTOS.get(k, {}).get('nombre', c['nombre'])) if c else ''
    html += ('<h2>2. Metodología y calidad del dato</h2><div class="box">'
             '<p><b>Cámaras con dato este periodo:</b></p><table class="def">%s</table>'
             '<p style="margin-top:10px"><b>Definiciones:</b></p><table class="def">'
             '<tr><td>Paso / aforo</td><td>Cada cruce de la línea virtual de conteo. No deduplica personas.</td></tr>'
             '<tr><td>Entrada / salida (LPR)</td><td>Lecturas de matrícula en sentido avance (entrada) o retroceso (salida) en esa cámara.</td></tr>'
             '<tr><td>Balance</td><td>Entradas − salidas EN ESA cámara. Indicador de cobertura/sentido, no de población.</td></tr>'
             '<tr><td>Matrícula extranjera</td><td>País de matrícula distinto de España, sobre el total de matrículas identificadas (excluye no legibles).</td></tr>'
             '</table></div>'
             '<div class="warn"><b>Nota de protección de datos (RGPD).</b> Las cámaras LPR captan matrículas, que son dato personal. '
             'El tratamiento debe ampararse en una base jurídica (interés público / competencias municipales de movilidad), aplicar '
             '<b>minimización y seudonimización</b> (uso agregado y estadístico, sin conservar la matrícula individual más allá del plazo necesario) '
             'y respetar el principio de limitación del plazo de conservación. El seguimiento individual de vehículos (matching entrada-salida del '
             'parking) requiere valoración específica antes de su puesta en marcha.</div>'
             '<div class="warn"><b>Limitaciones.</b> No se dispone del porcentaje de disponibilidad/caídas de cada cámara en el periodo; los datos '
             'de matrícula (LPR) solo llegan hasta junio de 2026; y aún no existe la cámara del parking disuasorio (puntos 4 y 5).</div>'
             % filas_cam)

    # Fichas
    html += '<h2>3. Ficha por punto de control</h2>' + fichas

    # Transversal
    html += ('<h2>4. Análisis transversal</h2>'
             '<div class="sub">Intensidad de paso por hora y día de la semana (todas las cámaras)</div>'
             '<p style="font-size:.78rem;color:#94a3b8;margin:2px 0 6px">Columnas = hora (00–23) · Filas = día (L→D) · más oscuro = más intensidad</p>'
             + heatmap(heat)
             + '<p style="font-size:.82rem;color:#475569;margin-top:8px">El mapa de calor permite ver la concentración horaria y el contraste laborable / fin de semana de un vistazo.</p>')
    html += prosa(an['transversal'])

    # Conclusiones y recomendaciones
    if an['conclusiones']:
        html += ('<h2>5. Conclusiones y recomendaciones</h2>'
                 '<p style="font-size:.82rem;color:#475569;margin:0 0 4px">Lectura operativa de los datos del periodo. Cada punto se apoya en las cifras de las fichas anteriores.</p>'
                 + conclusiones_html(an['conclusiones']))
        nsec = 6
    else:
        nsec = 5

    # Anexo
    html += ('<h2>%d. Anexos</h2><div class="box">Las tablas <b>diarias completas</b> por cámara (entradas, salidas, personas y vehículos) '
             'están disponibles para descarga en formato CSV/Excel junto a este informe. Este documento resume; el detalle diario va en el anexo.</div>' % nsec)

    html += ('<div class="foot">Fuente: cámaras LPR de tráfico y cámaras de aforo multiobjeto (HikCentral). '
             'Elaborado de forma automática para el SIT de Peñíscola. Los puntos «pendiente» requieren dar de alta o configurar cámaras por parte de la instalación.</div></body></html>')

    outdir = os.path.join(BASE, 'data', 'informes_sit'); os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, 'sit_pro_%s.html' % mes)
    open(out, 'w', encoding='utf-8').write(html)
    print('OK ->', out, '(%d KB)' % (os.path.getsize(out)//1024))
    # manifiesto de informes disponibles (para el selector del dashboard)
    man_path = os.path.join(outdir, 'manifest.json')
    man = {}
    if os.path.exists(man_path):
        try: man = {r['mes']: r for r in json.load(open(man_path, encoding='utf-8')).get('informes', [])}
        except Exception: man = {}
    man[mes] = {'mes': mes, 'label': d['periodoLabel'], 'archivo': 'sit_pro_%s.html' % mes}
    informes = [man[k] for k in sorted(man, reverse=True)]
    open(man_path, 'w', encoding='utf-8').write(json.dumps({'informes': informes}, ensure_ascii=False))
    print('Manifiesto actualizado:', len(informes), 'informe(s)')

if __name__ == '__main__':
    generar(sys.argv[1] if len(sys.argv) > 1 else '2026-06')
