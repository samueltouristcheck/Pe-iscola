# -*- coding: utf-8 -*-
"""
Construye data/camaras/sit_camaras.json: datos SIT de cámaras por mes y punto de
control (LPR + aforo peatones por franjas horarias), para consultarlo en el dashboard.

Uso: python generar_sit_camaras_datos.py 2026-06 2026-07
"""
import sys, os, re, json, glob

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
    return None

def aforo_franjas(csv_path, mes):
    mm = mes.split('-')[1]
    if not os.path.exists(csv_path):
        return None
    raw = open(csv_path, 'rb').read().decode('latin-1')
    fr = {etq: {'entrada': 0, 'salida': 0} for etq, _ in FRANJAS}
    por_hora = [{'h': h, 'entrada': 0, 'salida': 0} for h in range(24)]
    tot_ent = tot_sal = 0
    for l in raw.split('\n'):
        p = l.split(';')
        if len(p) < 6:
            continue
        m = re.match(r'\s*(\d{2})/(\d{2})\s+(\d{2}):00', p[1])
        if not m or m.group(1) != mm:
            continue
        h = int(m.group(3))
        def num(v):
            d = re.sub(r'\D', '', v or ''); return int(d) if d else 0
        ent, sal = num(p[2]), num(p[5])
        tot_ent += ent; tot_sal += sal
        por_hora[h]['entrada'] += ent; por_hora[h]['salida'] += sal
        etq = franja_de_hora(h)
        if etq:
            fr[etq]['entrada'] += ent; fr[etq]['salida'] += sal
    franjas = [{'etq': etq, 'entrada': fr[etq]['entrada'], 'salida': fr[etq]['salida']} for etq, _ in FRANJAS]
    pico = max(franjas, key=lambda x: x['entrada'] + x['salida'])
    return {'total_entrada': tot_ent, 'total_salida': tot_sal,
            'pico': pico['etq'], 'franjas': franjas, 'por_hora': por_hora}

def lpr_camara(todos, camara, mes):
    ch = todos['lpr'].get('porMes', {}).get(mes, {}).get('camaraHora', {}).get(camara, {})
    if not ch:
        return None
    entradas = salidas = 0
    por_hora = {h: 0 for h in range(24)}
    for h, o in ch.items():
        hi = int(h)
        entradas += o.get('av', 0); salidas += o.get('re', 0)
        por_hora[hi] += o.get('av', 0) + o.get('re', 0)
    pico_h = max(por_hora, key=por_hora.get)
    return {'entradas': entradas, 'salidas': salidas, 'balance': entradas - salidas,
            'pico': '%02d:00 - %02d:00 h' % (pico_h, (pico_h + 1) % 24),
            'por_hora': [{'h': h, 'total': por_hora[h]} for h in range(24)]}

def lpr_procedencia(mes, camaras):
    anio, mm = mes.split('-')
    files = glob.glob(os.path.join(BASE, 'data', 'camaras', 'Trafico_camaras', 'CSV', anio[2:] + mm + ' *.csv'))
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
        (res[cam]['nacional'] if pais == 'España' else res[cam]['extranjero'])
        if pais == 'España':
            res[cam]['nacional'] += 1
        else:
            res[cam]['extranjero'] += 1
    return res, True

def datos_mes(mes):
    anio, mm = mes.split('-')
    todos = json.load(open(os.path.join(BASE, 'data', 'camaras', 'todos.json'), encoding='utf-8'))
    CAMS_LPR = {
        'estibaliz': 'Estibaliz LPR',
        'irta': 'Calle Irta - San Antonio LPR',
        'abellers': 'Rotonda Abellers - Avda.Estacion LPR',
    }
    lpr = {k: lpr_camara(todos, v, mes) for k, v in CAMS_LPR.items()}
    proc_raw, hay_lpr = lpr_procedencia(mes, list(CAMS_LPR.values()))
    proc = {k: proc_raw.get(v, {'nacional': 0, 'extranjero': 0}) for k, v in CAMS_LPR.items()}
    afdir = os.path.join(BASE, 'data', 'camaras', 'Aforo_Horario')
    af_mar = aforo_franjas(os.path.join(afdir, 'AvdaDelMar_jun-ago2026_horario.csv'), mes)
    af_ayto = aforo_franjas(os.path.join(afdir, 'Ayuntamiento_jun-ago2026_horario.csv'), mes)
    af_fosc = aforo_franjas(os.path.join(afdir, 'CMayorBaluarte_jun-ago2026_horario.csv'), mes)
    af_santpere = aforo_franjas(os.path.join(afdir, 'SaizDeCarlos_jun-ago2026_horario.csv'), mes)

    def pl(n, titulo, key, sent_ent, sent_sal):
        d = lpr[key]
        if not d:
            return {'n': n, 'titulo': titulo, 'tipo': 'lpr', 'estado': 'sin_datos'}
        p = proc[key]; ident = p['nacional'] + p['extranjero']
        return {'n': n, 'titulo': titulo, 'tipo': 'lpr', 'estado': 'ok',
                'sentEnt': sent_ent, 'sentSal': sent_sal,
                'entradas': d['entradas'], 'salidas': d['salidas'], 'balance': d['balance'],
                'pico': d['pico'], 'porHora': d['por_hora'],
                'proc': {'nacional': p['nacional'], 'extranjero': p['extranjero'],
                         'ident': ident,
                         'pctNac': round(100.0 * p['nacional'] / ident, 1) if ident else 0,
                         'pctExt': round(100.0 * p['extranjero'] / ident, 1) if ident else 0}}

    def pa(n, titulo, af, ent_lbl, sal_lbl):
        if not af:
            return {'n': n, 'titulo': titulo, 'tipo': 'aforo', 'estado': 'sin_datos'}
        return {'n': n, 'titulo': titulo, 'tipo': 'aforo', 'estado': 'ok',
                'entLbl': ent_lbl, 'salLbl': sal_lbl,
                'entrada': af['total_entrada'], 'salida': af['total_salida'],
                'pico': af['pico'], 'franjas': af['franjas'], 'porHora': af['por_hora']}

    def pp(n, titulo, motivo):
        return {'n': n, 'titulo': titulo, 'tipo': 'pendiente', 'estado': 'pendiente', 'motivo': motivo}

    puntos = [
        pl(1, 'Rotonda Estíbaliz', 'estibaliz', 'entrada al municipio', 'salida del municipio'),
        pl(2, 'Cámara Calle Irta', 'irta', 'sentido A', 'sentido B'),
        pl(3, 'Rotonda Abellers', 'abellers', 'entrada', 'salida'),
        pp(4, 'Parking Disuasorio — Cámaras de vehículos (turismos)', 'La cámara aún no está dada de alta en el sistema, y falta el emparejado individual entrada/salida por matrícula.'),
        pp(5, 'Parking Disuasorio — Cámaras de autobuses', 'Cámara no disponible y sin dato de tiempo de permanencia por vehículo.'),
        pa(6, 'Cámara Portal Fosc (C Mayor – Baluarte del Príncipe)', af_fosc, 'entrada', 'salida'),
        pa(7, 'Cámara Avenida de la Mar', af_mar, 'entrada', 'salida'),
        pa(8, 'Cámara Ayuntamiento', af_ayto, 'subida', 'bajada'),
        pa(9, 'Cámara Portal de Sant Pere (C. Saiz de Carlos)', af_santpere, 'entrada', 'salida'),
    ]
    # totales de cabecera
    tot_veh_ent = sum(p['entradas'] for p in puntos if p.get('tipo') == 'lpr' and p['estado'] == 'ok')
    tot_veh_sal = sum(p['salidas'] for p in puntos if p.get('tipo') == 'lpr' and p['estado'] == 'ok')
    tot_peat = sum((p['entrada'] + p['salida']) for p in puntos if p.get('tipo') == 'aforo' and p['estado'] == 'ok')
    return {
        'periodoLabel': MESES_ES[int(mm) - 1].capitalize() + ' ' + anio,
        'anio': int(anio), 'mes': int(mm), 'hayLPR': hay_lpr,
        'kpis': {'vehEntradas': tot_veh_ent, 'vehSalidas': tot_veh_sal, 'peatones': tot_peat,
                 'puntosOk': sum(1 for p in puntos if p['estado'] == 'ok'),
                 'puntosPend': sum(1 for p in puntos if p['estado'] == 'pendiente')},
        'puntos': puntos, 'opinion': ''
    }

def main():
    meses = sys.argv[1:] or ['2026-06', '2026-07']
    out_path = os.path.join(BASE, 'data', 'camaras', 'sit_camaras.json')
    existing = {}
    if os.path.exists(out_path):
        try:
            existing = json.load(open(out_path, encoding='utf-8')).get('datos', {})
        except Exception:
            existing = {}
    datos = dict(existing)
    for mes in meses:
        d = datos_mes(mes)
        if mes in existing and existing[mes].get('opinion'):
            d['opinion'] = existing[mes]['opinion']  # conservar opinión ya generada
        datos[mes] = d
        print('OK', mes, '-> kpis', d['kpis'])
    salida = {'meses': sorted(datos.keys()), 'datos': datos}
    open(out_path, 'w', encoding='utf-8').write(json.dumps(salida, ensure_ascii=False))
    print('Guardado', out_path)

if __name__ == '__main__':
    main()
