# -*- coding: utf-8 -*-
"""
FASE 1 del rebuild del informe SIT de cámaras: capa de datos por cámara y diario.

Genera data/camaras/sit_fichas.json con, por mes y por cámara (punto de control):
  - serie DIARIA (entradas/salidas o personas/vehículos)
  - 8 franjas horarias + franja punta declarada (entrada y salida)
  - procedencia nacional/extranjera (LPR)
  - laborable vs fin de semana
  - heatmap hora × día de la semana
Fuentes: CSV crudo de matrículas (LPR) y CSV horario de aforo (multiobjeto).

Uso: python generar_sit_fichas.py 2026-06 2026-07
"""
import sys, os, re, json, glob, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
DIAS_SEM = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']

FRANJAS = [
    ('07:00–10:00', range(7, 10)), ('10:00–12:00', range(10, 12)),
    ('12:00–14:00', range(12, 14)), ('14:00–16:00', range(14, 16)),
    ('16:00–18:00', range(16, 18)), ('18:00–20:00', range(18, 20)),
    ('20:00–22:00', range(20, 22)), ('22:00–01:00', [22, 23, 0]),
]
def franja_idx(h):
    for i, (_, hrs) in enumerate(FRANJAS):
        if h in hrs:
            return i
    return None  # 01–07 h

def es_finde(y, m, d):
    return datetime.date(y, m, d).weekday() >= 5

def dow(y, m, d):
    return datetime.date(y, m, d).weekday()  # 0=lun..6=dom

# ---------- LPR por cámara desde el CSV crudo ----------
LPR_CAMS = {
    'estibaliz': 'Estibaliz LPR',
    'irta': 'Calle Irta - San Antonio LPR',
    'abellers': 'Rotonda Abellers - Avda.Estacion LPR',
}
def lpr_ficha(mes):
    anio, mm = mes.split('-'); yi, mi = int(anio), int(mm)
    files = glob.glob(os.path.join(BASE, 'data', 'camaras', 'Trafico_camaras', 'CSV', anio[2:] + mm + ' *.csv'))
    out = {k: None for k in LPR_CAMS}
    if not files:
        return out
    data = open(files[0], 'rb').read()
    try:
        raw = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raw = data.decode('latin-1')
    inv = {v: k for k, v in LPR_CAMS.items()}
    acc = {k: {'dia': {}, 'franjaEnt': [0]*8, 'franjaSal': [0]*8, 'nac': 0, 'ext': 0,
               'labEnt': 0, 'labSal': 0, 'finEnt': 0, 'finSal': 0,
               'heat': [[0]*24 for _ in range(7)]} for k in LPR_CAMS}
    for l in raw.split('\n'):
        p = l.split(';')
        if len(p) < 13:
            continue
        cam = p[3].strip().strip('"')
        k = inv.get(cam)
        if not k:
            continue
        m = re.search(r'(\d{4})/(\d{2})/(\d{2})\s+(\d{2}):', p[2])
        if not m or int(m.group(2)) != mi:
            continue
        d, h = int(m.group(3)), int(m.group(4))
        direc = p[12].strip().strip('"').lower()
        ent = 'avance' in direc
        sal = 'invertir' in direc
        a = acc[k]
        if d not in a['dia']:
            a['dia'][d] = {'ent': 0, 'sal': 0}
        if ent:
            a['dia'][d]['ent'] += 1
        elif sal:
            a['dia'][d]['sal'] += 1
        fi = franja_idx(h)
        if fi is not None:
            if ent: a['franjaEnt'][fi] += 1
            elif sal: a['franjaSal'][fi] += 1
        wd = dow(yi, mi, d)
        if ent: a['heat'][wd][h] += 1
        elif sal: a['heat'][wd][h] += 1
        fin = es_finde(yi, mi, d)
        if ent:
            a['finEnt' if fin else 'labEnt'] += 1
        elif sal:
            a['finSal' if fin else 'labSal'] += 1
        pais = p[7].strip().strip('"')
        if pais and pais not in ('--', 'País/Región'):
            a['nac' if pais == 'España' else 'ext'] += 1
    for k, a in acc.items():
        if not a['dia']:
            continue
        dias = sorted(a['dia'])
        tot_ent = sum(a['dia'][d]['ent'] for d in dias)
        tot_sal = sum(a['dia'][d]['sal'] for d in dias)
        def pico(arr):
            i = max(range(8), key=lambda x: arr[x]); return {'franja': FRANJAS[i][0], 'val': arr[i]}
        out[k] = {
            'tipo': 'lpr', 'nombre': LPR_CAMS[k],
            'totalEnt': tot_ent, 'totalSal': tot_sal, 'balance': tot_ent - tot_sal,
            'diario': [{'d': d, 'ent': a['dia'][d]['ent'], 'sal': a['dia'][d]['sal']} for d in dias],
            'franjas': [{'etq': FRANJAS[i][0], 'ent': a['franjaEnt'][i], 'sal': a['franjaSal'][i]} for i in range(8)],
            'picoEnt': pico(a['franjaEnt']), 'picoSal': pico(a['franjaSal']),
            'proc': {'nac': a['nac'], 'ext': a['ext'],
                     'pctExt': round(100 * a['ext'] / (a['nac'] + a['ext']), 1) if (a['nac'] + a['ext']) else 0},
            'lab': {'ent': a['labEnt'], 'sal': a['labSal']}, 'fin': {'ent': a['finEnt'], 'sal': a['finSal']},
            'heat': a['heat'],
        }
    return out

# ---------- Aforo por cámara desde el CSV horario ----------
AFORO_CAMS = {
    'fosc': ('CMayorBaluarte_jun-ago2026_horario.csv', 'Portal Fosc (C Mayor – Baluarte)'),
    'mar': ('AvdaDelMar_jun-ago2026_horario.csv', 'Avenida de la Mar'),
    'ayto': ('Ayuntamiento_jun-ago2026_horario.csv', 'Ayuntamiento'),
    'santpere': ('SaizDeCarlos_jun-ago2026_horario.csv', 'Portal de Sant Pere (C. Saiz de Carlos)'),
}
def num(v):
    d = re.sub(r'\D', '', v or ''); return int(d) if d else 0
def aforo_ficha(mes):
    anio, mm = mes.split('-'); yi, mi = int(anio), int(mm)
    afdir = os.path.join(BASE, 'data', 'camaras', 'Aforo_Horario')
    out = {}
    for k, (fname, nombre) in AFORO_CAMS.items():
        path = os.path.join(afdir, fname)
        if not os.path.exists(path):
            out[k] = None; continue
        raw = open(path, 'rb').read().decode('latin-1')
        dia = {}; franjaEnt = [0]*8; franjaSal = [0]*8
        labE = labS = finE = finS = 0; vehE = vehS = 0
        heat = [[0]*24 for _ in range(7)]
        for l in raw.split('\n'):
            p = l.split(';')
            if len(p) < 18:
                continue
            m = re.match(r'\s*(\d{2})/(\d{2})\s+(\d{2}):00', p[1])
            if not m or int(m.group(1)) != mi:
                continue
            d, h = int(m.group(2)), int(m.group(3))
            pe, ps = num(p[2]), num(p[5])        # personas avanzar / retroceso
            ve, vs = num(p[8]), num(p[11])        # veh motor avanzar / retroceso
            if d not in dia:
                dia[d] = {'ent': 0, 'sal': 0, 'vehEnt': 0, 'vehSal': 0}
            dia[d]['ent'] += pe; dia[d]['sal'] += ps; dia[d]['vehEnt'] += ve; dia[d]['vehSal'] += vs
            vehE += ve; vehS += vs
            fi = franja_idx(h)
            if fi is not None:
                franjaEnt[fi] += pe; franjaSal[fi] += ps
            wd = dow(yi, mi, d); heat[wd][h] += pe + ps
            if es_finde(yi, mi, d): finE += pe; finS += ps
            else: labE += pe; labS += ps
        if not dia:
            out[k] = None; continue
        dias = sorted(dia)
        te = sum(dia[d]['ent'] for d in dias); ts = sum(dia[d]['sal'] for d in dias)
        def pico(arr):
            i = max(range(8), key=lambda x: arr[x]); return {'franja': FRANJAS[i][0], 'val': arr[i]}
        out[k] = {
            'tipo': 'aforo', 'nombre': nombre,
            'totalEnt': te, 'totalSal': ts, 'vehEnt': vehE, 'vehSal': vehS,
            'diario': [{'d': d, 'ent': dia[d]['ent'], 'sal': dia[d]['sal'], 'vehEnt': dia[d]['vehEnt'], 'vehSal': dia[d]['vehSal']} for d in dias],
            'franjas': [{'etq': FRANJAS[i][0], 'ent': franjaEnt[i], 'sal': franjaSal[i]} for i in range(8)],
            'picoEnt': pico(franjaEnt), 'picoSal': pico(franjaSal),
            'lab': {'ent': labE, 'sal': labS}, 'fin': {'ent': finE, 'sal': finS},
            'heat': heat,
        }
    return out

def main():
    meses = sys.argv[1:] or ['2026-06', '2026-07']
    doc = {}
    for mes in meses:
        anio, mm = mes.split('-')
        lpr = lpr_ficha(mes)
        af = aforo_ficha(mes)
        doc[mes] = {
            'periodoLabel': MESES_ES[int(mm)-1].capitalize() + ' ' + anio,
            'lpr': lpr, 'aforo': af,
        }
        nlpr = sum(1 for v in lpr.values() if v); naf = sum(1 for v in af.values() if v)
        print('OK', mes, '-> LPR', nlpr, 'cámaras, aforo', naf, 'cámaras')
    out_path = os.path.join(BASE, 'data', 'camaras', 'sit_fichas.json')
    open(out_path, 'w', encoding='utf-8').write(json.dumps({'meses': list(doc.keys()), 'datos': doc}, ensure_ascii=False))
    print('Guardado', out_path, '(%d KB)' % (os.path.getsize(out_path)//1024))

if __name__ == '__main__':
    main()
