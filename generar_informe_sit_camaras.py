# -*- coding: utf-8 -*-
"""
Genera el informe SIT de cámaras (estilo pedido por el Ayuntamiento), por mes.

Puntos que SÍ podemos rellenar hoy:
  - Cámaras LPR de tráfico (Estíbaliz, Calle Irta, Rotonda Abellers):
    entradas/salidas, balance, franja horaria pico y procedencia nac./extranjera.
  - Aforo de peatones por 8 franjas horarias (Avda. del Mar, Ayuntamiento).
Los demás puntos (parking disuasorio, Portal Fosc, Sant Pere) quedan marcados
"pendiente de instalación/configuración".

Uso: python generar_informe_sit_camaras.py 2026-06
"""
import sys, os, re, json, csv, glob

BASE = os.path.dirname(os.path.abspath(__file__))
MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

FRANJAS = [
    ('07:00 - 10:00 h', range(7, 10)),
    ('10:00 - 12:00 h', range(10, 12)),
    ('12:00 - 14:00 h', range(12, 14)),
    ('14:00 - 16:00 h', range(14, 16)),
    ('16:00 - 18:00 h', range(16, 18)),
    ('18:00 - 20:00 h', range(18, 20)),
    ('20:00 - 22:00 h', range(20, 22)),
    ('22:00 - 01:00 h', [22, 23, 0]),
]
def franja_de_hora(h):
    for etq, hrs in FRANJAS:
        if h in hrs:
            return etq
    return None  # 01-07 h (madrugada), fuera de las franjas de la spec

def fmt(n):
    try:
        return format(int(round(n)), ',').replace(',', '.')
    except Exception:
        return str(n)

# ---------- Aforo peatones por franjas (desde el CSV horario exportado) ----------
def aforo_franjas(csv_path, mes):
    mm = mes.split('-')[1]
    raw = open(csv_path, 'rb').read().decode('latin-1')
    lines = [l.rstrip('\r') for l in raw.split('\n')]
    fr = {etq: {'entrada': 0, 'salida': 0} for etq, _ in FRANJAS}
    madrugada = {'entrada': 0, 'salida': 0}
    tot_ent = tot_sal = 0
    for l in lines:
        p = l.split(';')
        if len(p) < 6:
            continue
        m = re.match(r'\s*(\d{2})/(\d{2})\s+(\d{2}):00', p[1])
        if not m:
            continue
        if m.group(1) != mm:  # solo el mes pedido
            continue
        h = int(m.group(3))
        def num(v):
            d = re.sub(r'\D', '', v or ''); return int(d) if d else 0
        ent = num(p[2])   # personas avanzar
        sal = num(p[5])   # personas retroceso
        tot_ent += ent; tot_sal += sal
        etq = franja_de_hora(h)
        if etq is None:
            madrugada['entrada'] += ent; madrugada['salida'] += sal
        else:
            fr[etq]['entrada'] += ent; fr[etq]['salida'] += sal
    # franja pico (por total entrada+salida)
    pico = max(fr.items(), key=lambda kv: kv[1]['entrada'] + kv[1]['salida'])
    return {'franjas': fr, 'madrugada': madrugada, 'total_entrada': tot_ent,
            'total_salida': tot_sal, 'pico': pico[0]}

# ---------- LPR por cámara (entradas/salidas/pico desde todos.json) ----------
def lpr_camara(todos, camara, mes):
    pm = todos['lpr'].get('porMes', {}).get(mes, {})
    ch = pm.get('camaraHora', {}).get(camara, {})
    if not ch:
        return None
    entradas = salidas = 0
    por_hora = {}
    for h, o in ch.items():
        hi = int(h)
        entradas += o.get('av', 0); salidas += o.get('re', 0)
        por_hora[hi] = por_hora.get(hi, 0) + o.get('av', 0) + o.get('re', 0)
    pico_h = max(por_hora, key=por_hora.get) if por_hora else None
    return {'entradas': entradas, 'salidas': salidas,
            'balance': entradas - salidas,
            'pico': ('%02d:00 - %02d:00 h' % (pico_h, (pico_h + 1) % 24)) if pico_h is not None else '—'}

# ---------- Procedencia por cámara (desde el CSV crudo de matrículas) ----------
def lpr_procedencia(mes, camaras):
    anio, mm = mes.split('-')
    # localizar el CSV del mes (p.ej. "2606 Matriculas Jun 26.csv")
    patron = os.path.join(BASE, 'data', 'camaras', 'Trafico_camaras', 'CSV', anio[2:] + mm + ' *.csv')
    files = glob.glob(patron)
    res = {c: {'nacional': 0, 'extranjero': 0} for c in camaras}
    if not files:
        return res, False
    data = open(files[0], 'rb').read()
    try:
        raw = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raw = data.decode('latin-1')
    setcam = set(camaras)
    for l in raw.split('\n'):
        p = l.split(';')
        if len(p) < 8:
            continue
        cam = p[3].strip().strip('"')
        if cam not in setcam:
            continue
        pais = p[7].strip().strip('"')
        if not pais or pais in ('--', 'País/Región'):
            continue
        if pais == 'España':
            res[cam]['nacional'] += 1
        else:
            res[cam]['extranjero'] += 1
    return res, True

# ---------- HTML ----------
def tabla_franjas(fr):
    filas = ''
    for etq, _ in FRANJAS:
        d = fr['franjas'][etq]
        filas += ('<tr><td>%s</td><td class="n">%s</td><td class="n">%s</td><td class="n">%s</td></tr>'
                  % (etq, fmt(d['entrada']), fmt(d['salida']), fmt(d['entrada'] + d['salida'])))
    return ('<table class="fr"><thead><tr><th>Franja horaria</th><th>Entrada</th><th>Salida</th><th>Total</th></tr></thead>'
            '<tbody>%s</tbody></table>' % filas)

def punto_lpr(n, titulo, cam_key, cam_data, proc, extra=''):
    if not cam_data:
        return '<h3>%d. %s</h3><p class="pend">Sin datos de matrículas para este mes.</p>' % (n, titulo)
    p = proc.get(cam_key, {'nacional': 0, 'extranjero': 0})
    ident = p['nacional'] + p['extranjero']
    pn = (100.0 * p['nacional'] / ident) if ident else 0
    px = (100.0 * p['extranjero'] / ident) if ident else 0
    return ('<h3>%d. %s</h3>'
            '<ul>'
            '<li>Vehículos sentido <b>%s</b>: <b>%s</b></li>'
            '<li>Vehículos sentido <b>%s</b>: <b>%s</b></li>'
            '<li>Balance del periodo (entradas − salidas): <b>%s</b></li>'
            '<li>Franja horaria de mayor intensidad: <b>%s</b></li>'
            '<li>Procedencia: <b>%s nacionales (%.1f%%)</b> y <b>%s extranjeros (%.1f%%)</b> '
            '<span class="nota">(sobre %s matrículas identificadas)</span></li>'
            '</ul>' % (n, titulo,
                      extra.split('|')[0] if extra else 'entrada', fmt(cam_data['entradas']),
                      extra.split('|')[1] if extra else 'salida', fmt(cam_data['salidas']),
                      fmt(cam_data['balance']), cam_data['pico'],
                      fmt(p['nacional']), pn, fmt(p['extranjero']), px, fmt(ident)))

def punto_aforo(n, titulo, af, etiquetas):
    ent_lbl, sal_lbl = etiquetas
    return ('<h3>%d. %s</h3>'
            '<ul>'
            '<li>Peatones sentido <b>%s</b> (mes): <b>%s</b></li>'
            '<li>Peatones sentido <b>%s</b> (mes): <b>%s</b></li>'
            '<li>Franja horaria de mayor concentración: <b>%s</b></li>'
            '</ul>'
            '<p class="sub">Desglose por franjas horarias:</p>%s' %
            (n, titulo, ent_lbl, fmt(af['total_entrada']), sal_lbl, fmt(af['total_salida']),
             af['pico'], tabla_franjas(af)))

def punto_pendiente(n, titulo, motivo):
    return '<h3>%d. %s</h3><p class="pend">⏳ Pendiente: %s</p>' % (n, titulo, motivo)

def generar(mes):
    anio, mm = mes.split('-')
    nombre_mes = MESES_ES[int(mm) - 1].capitalize()
    todos = json.load(open(os.path.join(BASE, 'data', 'camaras', 'todos.json'), encoding='utf-8'))

    CAMS_LPR = {
        'estibaliz': 'Estibaliz LPR',
        'irta': 'Calle Irta - San Antonio LPR',
        'abellers': 'Rotonda Abellers - Avda.Estacion LPR',
    }
    lpr = {k: lpr_camara(todos, v, mes) for k, v in CAMS_LPR.items()}
    proc, hay_lpr = lpr_procedencia(mes, list(CAMS_LPR.values()))
    proc = {k: proc.get(v, {}) for k, v in CAMS_LPR.items()}

    afdir = os.path.join(BASE, 'data', 'camaras', 'Aforo_Horario')
    af_mar = aforo_franjas(os.path.join(afdir, 'AvdaDelMar_jun-ago2026_horario.csv'), mes)
    af_ayto = aforo_franjas(os.path.join(afdir, 'Ayuntamiento_jun-ago2026_horario.csv'), mes)

    partes = []
    partes.append(punto_lpr(1, 'Rotonda Estíbaliz', 'estibaliz', lpr['estibaliz'], proc, 'entrada al municipio|salida del municipio'))
    partes.append(punto_lpr(2, 'Cámara Calle Irta', 'irta', lpr['irta'], proc, 'A (avance)|B (retroceso)') +
                  '<p class="nota">Nota: confirmar con el Ayuntamiento qué sentido corresponde a «Pueblo» y cuál a «Parque».</p>')
    partes.append(punto_lpr(3, 'Rotonda Abellers', 'abellers', lpr['abellers'], proc, 'entrada|salida'))
    partes.append(punto_pendiente(4, 'Parking Disuasorio — Cámaras de vehículos (turismos)',
                                  'la cámara aún no está dada de alta en el sistema, y falta el emparejado individual entrada/salida por matrícula.'))
    partes.append(punto_pendiente(5, 'Parking Disuasorio — Cámaras de autobuses',
                                  'cámara no disponible y sin dato de tiempo de permanencia por vehículo.'))
    partes.append(punto_pendiente(6, 'Cámara Portal Fosc',
                                  'cámara no dada de alta como aforo; además requiere desplazar la línea virtual de conteo (configuración física).'))
    partes.append(punto_aforo(7, 'Cámara Avenida de la Mar', af_mar, ('entrada', 'salida')))
    partes.append(punto_aforo(8, 'Cámara Ayuntamiento', af_ayto, ('subida', 'bajada')))
    partes.append(punto_pendiente(9, 'Cámara Portal de Sant Pere',
                                  'cámara no dada de alta en el sistema.'))

    intro = ('<p>Con el fin de mejorar el análisis de la movilidad, los flujos de visitantes y el comportamiento '
             'de los usuarios del destino, se incorpora al informe periódico del Sistema de Inteligencia Turística (SIT) '
             'la información obtenida a través de las cámaras de control de tráfico y aforo del municipio. '
             'A continuación se detalla, punto de control por punto de control, la información correspondiente a '
             '<b>%s de %s</b>.</p>' % (nombre_mes, anio))
    if not hay_lpr:
        intro += ('<p class="pend">⚠️ Este mes aún no dispone de datos de matrículas (LPR); los puntos 1–3 se completarán '
                  'cuando se suban al sistema.</p>')

    css = """
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;max-width:820px;margin:0 auto;padding:28px;line-height:1.5}
    h1{font-size:19px;text-align:center;border-bottom:3px solid #2563eb;padding-bottom:10px;color:#0f172a}
    h3{font-size:15px;margin:22px 0 6px;color:#1d4ed8;border-left:4px solid #2563eb;padding-left:8px}
    ul{margin:6px 0 6px 4px;padding-left:18px}li{margin:3px 0}
    .sub{margin:8px 0 4px;font-weight:600;color:#475569;font-size:13px}
    table.fr{border-collapse:collapse;width:100%;margin:4px 0 14px;font-size:13px}
    table.fr th{background:#eff6ff;color:#1e40af;text-align:left;padding:6px 8px;border:1px solid #dbeafe}
    table.fr td{padding:5px 8px;border:1px solid #e2e8f0}
    table.fr td.n{text-align:right;font-variant-numeric:tabular-nums}
    .pend{color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;font-size:13px}
    .nota{color:#94a3b8;font-size:12px}
    .foot{margin-top:26px;border-top:1px solid #e2e8f0;padding-top:10px;color:#64748b;font-size:12px}
    """
    html = ('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe SIT Cámaras %s %s</title>'
            '<style>%s</style></head><body>'
            '<h1>INFORME DE CÁMARAS DE CONTROL DE TRÁFICO Y AFORO<br>PARA EL SISTEMA DE INTELIGENCIA TURÍSTICA (SIT) — PEÑÍSCOLA</h1>'
            '<p style="text-align:center;color:#64748b;margin-top:-4px">%s de %s</p>'
            '%s%s'
            '<div class="foot">Fuente: cámaras LPR de tráfico y cámaras de aforo multiobjetivo (HikCentral). '
            'Datos LPR y de aforo del periodo indicado. Los puntos marcados como «pendiente» requieren dar de alta o '
            'configurar cámaras por parte de la instalación.</div>'
            '</body></html>') % (nombre_mes, anio, css, nombre_mes, anio, intro, ''.join(partes))

    outdir = os.path.join(BASE, 'data', 'informes_sit')
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, 'camaras_sit_%s.html' % mes)
    open(out, 'w', encoding='utf-8').write(html)
    print('OK ->', out)
    # resumen por consola
    print('  LPR Estíbaliz:', lpr['estibaliz'])
    print('  Aforo Del Mar total entrada/salida:', af_mar['total_entrada'], '/', af_mar['total_salida'], '| pico:', af_mar['pico'])
    print('  Aforo Ayto total subida/bajada:', af_ayto['total_entrada'], '/', af_ayto['total_salida'], '| pico:', af_ayto['pico'])

if __name__ == '__main__':
    generar(sys.argv[1] if len(sys.argv) > 1 else '2026-06')
