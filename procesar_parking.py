# -*- coding: utf-8 -*-
"""
Procesa los CSV de entrada/salida del Parking Peñismar (ANPR por matrícula) y
genera data/camaras/parking.json con AGREGADOS (sin matrículas individuales):
tiempo de estancia, % que se quedan, entradas/salidas por día y hora, autobuses.

Fuente: exportaciones ANPR de las cámaras "Pk. Peñismar - Entrada / - Salida /
- Acceso Autobuses" (una por mes) en data/camaras/parking/*.csv.

Método del tiempo de estancia: por cada matrícula, se ordenan sus pasos y se
emparejan en FIFO cada Entrada con la siguiente Salida (permanencias de 0 a 24 h).
El ~12% de matrículas "Unknown" y los pasos sin pareja no computan en la media.
"""
import csv, io, os, glob, json, statistics
from datetime import datetime
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, 'data', 'camaras', 'parking')
OUT = os.path.join(BASE, 'data', 'camaras', 'parking.json')

MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
         'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}
MES_NOM = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
           'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']


def kind_of(camara):
    c = camara.lower()
    if 'autobus' in c or 'autobús' in c or 'bus' in c:
        return 'bus'
    if 'salida' in c:
        return 'sal'
    if 'entrada' in c:
        return 'ent'
    return '?'


def leer_csv(path):
    with io.open(path, encoding='utf-8-sig') as f:
        lines = f.read().split('\n')
    hidx = None
    for i, l in enumerate(lines):
        if 'Número de matrícula' in l or 'Numero de matricula' in l:
            hidx = i
            break
    if hidx is None:
        return []
    r = csv.reader(io.StringIO('\n'.join(lines[hidx:])), delimiter=';')
    header = next(r)

    def col(name):
        for i, h in enumerate(header):
            if name in h:
                return i
        return -1
    iM, iH, iC = col('matrícula'), col('Hora'), col('Cámara')
    if iM < 0:
        iM = col('matricula')
    recs = []
    for row in r:
        if len(row) <= max(iM, iH, iC):
            continue
        m = row[iM].replace('="', '').replace('"', '').strip()
        h = row[iH].strip().strip('"')
        c = row[iC].strip().strip('"')
        try:
            t = datetime.strptime(h, '%Y/%m/%d %H:%M:%S')
        except ValueError:
            continue
        recs.append((m, t, kind_of(c)))
    return recs


def emparejar_estancias(recs):
    """FIFO: cada Entrada con la siguiente Salida de la misma matrícula. Devuelve minutos."""
    byplate = defaultdict(list)
    for m, t, k in recs:
        if not m or m == 'Unknown':
            continue
        if k in ('ent', 'sal'):
            byplate[m].append((t, k))
    dwell = []
    entradas_tot = 0
    for m, evs in byplate.items():
        evs.sort()
        abiertas = []
        for t, k in evs:
            if k == 'ent':
                abiertas.append(t)
                entradas_tot += 1
            elif k == 'sal' and abiertas:
                et = abiertas.pop(0)
                d = (t - et).total_seconds() / 60.0
                if 0 < d <= 24 * 60:
                    dwell.append(d)
    return dwell, entradas_tot


def resumen_mes(recs):
    ent = sum(1 for _, _, k in recs if k == 'ent')
    sal = sum(1 for _, _, k in recs if k == 'sal')
    bus = sum(1 for _, _, k in recs if k == 'bus')
    legibles = sum(1 for m, _, _ in recs if m and m != 'Unknown')
    dwell, ent_pareables = emparejar_estancias(recs)
    # Distribución de permanencia
    buckets = [('<30 min', 0, 30), ('30–60 min', 30, 60), ('1–2 h', 60, 120),
               ('2–4 h', 120, 240), ('4–8 h', 240, 480), ('>8 h', 480, 10**9)]
    dist = []
    for lbl, a, b in buckets:
        n = sum(1 for d in dwell if a <= d < b)
        dist.append({'rango': lbl, 'n': n, 'pct': round(100 * n / len(dwell), 1) if dwell else 0})
    # Por hora del día (entradas/salidas)
    porHora = {h: {'ent': 0, 'sal': 0} for h in range(24)}
    for _, t, k in recs:
        if k == 'ent':
            porHora[t.hour]['ent'] += 1
        elif k == 'sal':
            porHora[t.hour]['sal'] += 1
    # Por día
    porDia = defaultdict(lambda: {'ent': 0, 'sal': 0})
    for _, t, k in recs:
        d = t.strftime('%Y-%m-%d')
        if k == 'ent':
            porDia[d]['ent'] += 1
        elif k == 'sal':
            porDia[d]['sal'] += 1
    return {
        'entradas': ent, 'salidas': sal, 'bus': bus,
        'matriculas_legibles': legibles, 'pasos_totales': len(recs),
        'estancia': {
            'emparejadas': len(dwell),
            'entradas_pareables': ent_pareables,
            'pct_emparejadas': round(100 * len(dwell) / ent_pareables, 1) if ent_pareables else 0,
            'media_min': round(statistics.mean(dwell), 1) if dwell else None,
            'mediana_min': round(statistics.median(dwell), 1) if dwell else None,
            'pct_corta_30': round(100 * sum(1 for d in dwell if d < 30) / len(dwell), 1) if dwell else None,
            'pct_larga_2h': round(100 * sum(1 for d in dwell if d >= 120) / len(dwell), 1) if dwell else None,
            'distribucion': dist,
        },
        'porHora': [{'hora': h, 'ent': porHora[h]['ent'], 'sal': porHora[h]['sal']} for h in range(24)],
        'porDia': [{'fecha': d, 'ent': porDia[d]['ent'], 'sal': porDia[d]['sal']} for d in sorted(porDia)],
    }


def mes_de_fichero(fn):
    low = os.path.basename(fn).lower()
    for nom, num in MESES.items():
        if nom in low:
            return num
    return None


def main():
    files = sorted(glob.glob(os.path.join(DIR, '*.csv')))
    meses = {}
    todos = []
    anio = None
    for f in files:
        recs = leer_csv(f)
        if not recs:
            continue
        todos.extend(recs)
        num = mes_de_fichero(f)
        if anio is None and recs:
            anio = recs[0][1].year
        key = MES_NOM[num - 1] if num else os.path.basename(f)
        meses[key] = resumen_mes(recs)
    total = resumen_mes(todos) if todos else {}
    db = {
        'fuente': 'Cámaras ANPR Parking Peñismar (Entrada / Salida / Acceso Autobuses)',
        'destino': 'Parking disuasorio Peñismar',
        'nota': ('Tiempo de estancia calculado emparejando por matrícula cada entrada con su '
                 'siguiente salida (FIFO). No se guardan matrículas individuales, solo agregados. '
                 'Las matrículas no legibles (~12%) y los pasos sin pareja no entran en la media.'),
        'anio': anio,
        'meses': meses,
        'total': total,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(db, fh, ensure_ascii=False, indent=1)
    print('OK ->', OUT)
    for k, v in meses.items():
        e = v['estancia']
        print('  {}: {} entradas, {} salidas, estancia media {} min (mediana {}), {}% >2h'.format(
            k, v['entradas'], v['salidas'], e['media_min'], e['mediana_min'], e['pct_larga_2h']))


if __name__ == '__main__':
    main()
